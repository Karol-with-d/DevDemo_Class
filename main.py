import socket

HOST = "127.0.0.1"
PORT = 8000


def _port_is_open(host, port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.4)
        return sock.connect_ex((host, port)) == 0


# npm run dev already starts this API. A second process used to load the
# models and then crash with WinError 10048 because port 8000 was taken.
if __name__ == "__main__" and _port_is_open(HOST, PORT):
    print(f"Backend already running at http://{HOST}:{PORT}")
    raise SystemExit(0)

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
import asyncio
import json
import math
import os
import time

from live_caption import relay_live_transcription
from local_video_storage import LOCAL_VIDEO_PREFIX, local_video_path, store_local_video
from pose_analyzer import PoseSessionAnalyzer, run_mediapipe_detection
from rubric import suggest_rubric
from transcriber import (
    TranscriptSession,
    attach_evaluation_report,
    attach_video_key,
    attach_video_metrics,
    delete_local_session,
    list_saved_recordings,
    load_session_record,
    replace_session_transcript,
    safe_session_id,
    transcribe_recording_file,
    transcribe_speed_demo,
)
from s3_storage import (
    allow_local_evaluation_fallback,
    allow_local_video_fallback,
    delete_video_object,
    is_s3_configured,
    media_type_for,
    read_evaluation_json,
    read_video_object,
    upload_evaluation_json,
    upload_video_bytes,
)

# The latest socket for a recording wins. A replaced socket must not overwrite its subtitles.
active_transcripts = {}
# Post-recording full-audio transcription tasks keyed by session_id so reads await them.
pending_transcriptions: dict[str, asyncio.Task] = {}


async def await_pending_transcription(session_id: str) -> None:
    task = pending_transcriptions.get(safe_session_id(session_id))
    if task is None:
        return
    try:
        await asyncio.shield(task)
    except asyncio.CancelledError:
        pass
    except Exception as exc:
        print(f"[WARN] Transcripción final pendiente ({session_id}): {exc}", flush=True)


async def await_all_pending_transcriptions() -> None:
    tasks = list(pending_transcriptions.values())
    if not tasks:
        return
    await asyncio.gather(*(asyncio.shield(task) for task in tasks), return_exceptions=True)


def _schedule_final_transcription(
    session_id: str,
    *,
    audio_bytes: bytes | None,
    audio_filename: str,
    audio_content_type: str,
    video_path=None,
    video_bytes: bytes | None = None,
    video_filename: str = "recording.webm",
    video_content_type: str = "video/webm",
    metadata: dict | None = None,
    duration_seconds: float = 0.0,
) -> asyncio.Task:
    key = safe_session_id(session_id)
    previous = pending_transcriptions.get(key)
    if previous and not previous.done():
        previous.cancel()

    async def _run():
        try:
            existing = load_session_record(key) or {}
            live_segments = existing.get("segments") or []
            segments = await asyncio.to_thread(
                transcribe_recording_file,
                audio_bytes=audio_bytes,
                audio_filename=audio_filename,
                audio_content_type=audio_content_type,
                video_path=video_path,
                video_bytes=video_bytes,
                video_filename=video_filename,
                video_content_type=video_content_type,
                technology=(metadata or {}).get("technology") or existing.get("technology") or "",
                duration_seconds=duration_seconds,
                live_segments=live_segments,
            )
            if segments or not live_segments:
                await asyncio.to_thread(replace_session_transcript, key, segments, metadata=metadata)
            else:
                print(
                    f"[WARN] Transcripción final vacía para {key}; se conserva la transcripción en vivo.",
                    flush=True,
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print(f"[ERROR] Transcripción final ({key}): {exc}", flush=True)
        finally:
            if pending_transcriptions.get(key) is task:
                pending_transcriptions.pop(key, None)

    task = asyncio.create_task(_run())
    pending_transcriptions[key] = task
    return task

app = FastAPI()

# Permitir conexiones Cross-Origin (CORS) para Next.js
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

cv2 = None
np = None
mp = None
pose_landmarker = None
face_landmarker = None

try:
    import cv2
    import numpy as np
    import mediapipe as mp
    from mediapipe.tasks.python import vision
    from mediapipe.tasks.python import BaseOptions
except Exception as exc:
    print(f"[WARN] OpenCV no se pudo cargar: {exc}")
else:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    possible_pose_models = [
        "pose_landmarker_heavy.task",
        "pose_landmarker_full.task",
        "pose_landmarker_lite.task",
    ]
    pose_model_path = next(
        (
            os.path.join(script_dir, name)
            for name in possible_pose_models
            if os.path.exists(os.path.join(script_dir, name))
        ),
        None,
    )
    try:
        if pose_model_path:
            pose_options = vision.PoseLandmarkerOptions(
                base_options=BaseOptions(model_asset_path=pose_model_path),
                running_mode=vision.RunningMode.IMAGE,
                # 0.2 keeps the body when the teacher turns away. Only the
                # back-facing warning confirms quickly; other signals stay slow.
                min_pose_detection_confidence=0.2,
                min_pose_presence_confidence=0.2,
                min_tracking_confidence=0.2,
            )
            pose_landmarker = vision.PoseLandmarker.create_from_options(pose_options)
        face_model_path = os.path.join(script_dir, "face_landmarker.task")
        if os.path.exists(face_model_path):
            face_options = vision.FaceLandmarkerOptions(
                base_options=BaseOptions(model_asset_path=face_model_path),
                running_mode=vision.RunningMode.IMAGE,
                min_face_detection_confidence=0.3,
                min_face_presence_confidence=0.3,
                min_tracking_confidence=0.3,
                output_face_blendshapes=True,
                output_facial_transformation_matrixes=True,
                num_faces=1,
            )
            face_landmarker = vision.FaceLandmarker.create_from_options(face_options)
    except Exception as exc:
        print(f"[WARN] Modelos MediaPipe no se pudieron cargar: {exc}")

@app.get("/")
def read_root():
    return {
        "status": "ok",
        "service": "pose-and-face-analysis",
        "face_model_loaded": face_landmarker is not None,
        "pose_model_loaded": pose_landmarker is not None,
    }


@app.post("/upload-video")
async def upload_video(
    file: UploadFile = File(...),
    audio: UploadFile | None = File(None),
    sessionId: str = Form(""),
    candidateName: str = Form(""),
    evaluatorName: str = Form(""),
    technology: str = Form(""),
    complexity: str = Form(""),
    durationSeconds: float = Form(0.0),
):
    if not await file.read(1):
        raise HTTPException(status_code=400, detail="El archivo de video está vacío.")
    await file.seek(0)
    session_id = safe_session_id(sessionId)
    content_type = file.content_type or ""
    filename = file.filename or ""
    metadata = {
        "candidateName": candidateName or "Candidato",
        "evaluatorName": evaluatorName,
        "technology": technology,
        "complexity": complexity,
    }

    source = "local" if (not is_s3_configured() and allow_local_video_fallback()) else "s3"

    audio_bytes = None
    audio_filename = "audio.webm"
    audio_content_type = "audio/webm"
    if audio is not None:
        raw_audio = await audio.read()
        if raw_audio:
            audio_bytes = raw_audio
            audio_filename = audio.filename or "audio.webm"
            audio_content_type = audio.content_type or "audio/webm"

    transcription_task = None
    if audio_bytes and (source == "local" or is_s3_configured()):
        # Start full-audio transcription right away so it overlaps with S3/disk storage.
        transcription_task = _schedule_final_transcription(
            session_id,
            audio_bytes=audio_bytes,
            audio_filename=audio_filename,
            audio_content_type=audio_content_type,
            metadata=metadata,
            duration_seconds=durationSeconds,
        )

    video_bytes = None
    try:
        if source == "s3":
            video_bytes = await file.read()
            try:
                result = await asyncio.to_thread(
                    upload_video_bytes, video_bytes, session_id, content_type, filename,
                )
            except RuntimeError as exc:
                raise HTTPException(status_code=503, detail=str(exc)) from exc
            except Exception as exc:
                print(f"[ERROR] Subida a S3: {exc}")
                raise HTTPException(status_code=502, detail="No se pudo subir el video a S3.") from exc
        else:
            try:
                result = await asyncio.to_thread(
                    store_local_video, file.file, session_id, content_type, filename,
                )
            except (OSError, ValueError) as exc:
                print(f"[ERROR] Guardando video local: {exc}")
                raise HTTPException(status_code=500, detail="No se pudo guardar el video localmente.") from exc

        previous_key = (load_session_record(session_id) or {}).get("videoKey")
        try:
            if source == "local" and not local_video_path(result["key"]).is_file():
                raise FileNotFoundError("El video local ya no está disponible.")
            await asyncio.to_thread(attach_video_key, session_id, result["key"], metadata=metadata)
        except (OSError, ValueError) as exc:
            if source == "local":
                try:
                    local_video_path(result["key"]).unlink(missing_ok=True)
                except (OSError, ValueError) as cleanup_error:
                    print(f"[WARN] No se pudo eliminar el video sin registrar: {cleanup_error}")
            print(f"[ERROR] Actualizando el historial del video: {exc}")
            raise HTTPException(status_code=500, detail="No se pudo registrar el video en el historial.") from exc
    except BaseException:
        if transcription_task is not None and not transcription_task.done():
            transcription_task.cancel()
        raise

    if previous_key and previous_key.startswith(LOCAL_VIDEO_PREFIX):
        try:
            local_video_path(previous_key).unlink(missing_ok=True)
        except (OSError, ValueError) as exc:
            print(f"[WARN] No se pudo eliminar la versión anterior del video local: {exc}")

    if transcription_task is None:
        transcription_task = _schedule_final_transcription(
            session_id,
            audio_bytes=None,
            audio_filename=audio_filename,
            audio_content_type=audio_content_type,
            video_path=local_video_path(result["key"]) if source == "local" else None,
            video_bytes=video_bytes if source == "s3" else None,
            video_filename=filename or "recording.webm",
            video_content_type=content_type or "video/webm",
            metadata=metadata,
            duration_seconds=durationSeconds,
        )

    transcript_status = "ready" if transcription_task.done() else "processing"
    return {**result, "source": source, "savedInSystem": True, "transcriptStatus": transcript_status}


@app.get("/recordings")
async def get_recordings():
    await await_all_pending_transcriptions()
    return {"recordings": list_saved_recordings()}


@app.post("/evaluations/{session_id}")
async def save_evaluation(session_id: str, payload: dict):
    if not payload:
        raise HTTPException(status_code=400, detail="Los datos de evaluación están vacíos.")

    use_local = (not is_s3_configured()) and allow_local_evaluation_fallback()
    source = "local" if use_local else "s3"
    result = {"key": None, "savedInS3": False}
    if source == "s3":
        try:
            result = await asyncio.to_thread(upload_evaluation_json, session_id, payload)
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except Exception as exc:
            print(f"[ERROR] Guardando evaluación en S3: {exc}")
            raise HTTPException(status_code=502, detail="No se pudo guardar la evaluación en S3.") from exc

    try:
        attach_evaluation_report(session_id, payload, source=source)
    except OSError as exc:
        print(f"[ERROR] Guardando evaluación local: {exc}")
        detail = (
            "Se guardó en AWS S3, pero no se pudo actualizar el historial local."
            if source == "s3"
            else "No se pudo guardar la evaluación localmente."
        )
        raise HTTPException(status_code=500, detail=detail) from exc
    return {"ok": True, "sessionId": session_id, "source": source, **result}


@app.get("/evaluations/{session_id}")
async def get_evaluation(session_id: str):
    await await_pending_transcription(session_id)
    record = load_session_record(session_id) or {}
    local_evaluation = record.get("evaluation")
    s3_evaluation = None
    if is_s3_configured() and record.get("evaluationStorage") != "local":
        try:
            s3_evaluation = await asyncio.to_thread(read_evaluation_json, session_id)
        except RuntimeError as exc:
            if not local_evaluation:
                raise HTTPException(status_code=503, detail="No se pudo consultar la evaluación guardada.") from exc

    return {
        "ok": True,
        "source": "s3" if s3_evaluation is not None else "local" if local_evaluation else None,
        "evaluation": s3_evaluation if s3_evaluation is not None else local_evaluation,
        "segments": record.get("segments") or [],
        "vocabulary": record.get("vocabulary") or [],
        "muletillas": record.get("muletillas") or {},
        "videoMetrics": record.get("videoMetrics"),
    }


@app.post("/evaluations/{session_id}/suggestions")
async def get_rubric_suggestions(session_id: str):
    await await_pending_transcription(session_id)
    record = load_session_record(session_id)
    if not record:
        return {"dimensions": []}
    try:
        dimensions = await asyncio.to_thread(suggest_rubric, record)
    except Exception as exc:
        print(f"[WARN] No se pudo generar la rúbrica: {type(exc).__name__}")
        raise HTTPException(
            status_code=502,
            detail="No se pudieron generar sugerencias. Puedes completar la rúbrica manualmente.",
        ) from exc
    return {"dimensions": dimensions}


@app.get("/video")
async def play_video(key: str, download: bool = False):
    if key.startswith(LOCAL_VIDEO_PREFIX):
        try:
            path = local_video_path(key)
            if not path.is_file():
                raise HTTPException(status_code=404, detail="No se encontró el video local.")
        except (ValueError, OSError) as exc:
            raise HTTPException(status_code=404, detail="No se encontró el video local.") from exc
        return FileResponse(
            path,
            media_type=media_type_for(path.name),
            filename=path.name,
            content_disposition_type="attachment" if download else "inline",
            headers={"Cache-Control": "private, no-cache"},
        )
    try:
        data, content_type = await asyncio.to_thread(read_video_object, key)
    except RuntimeError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    filename = os.path.basename(key) or "grabacion.webm"
    disposition = (
        f'attachment; filename="{filename}"' if download else "inline"
    )
    return Response(
        content=data,
        media_type=content_type,
        headers={"Content-Disposition": disposition, "Cache-Control": "private, max-age=3600"},
    )


@app.delete("/recordings/{session_id}")
async def delete_recording(session_id: str):
    pending_task = pending_transcriptions.pop(safe_session_id(session_id), None)
    if pending_task is not None and not pending_task.done():
        pending_task.cancel()
        try:
            await pending_task
        except (asyncio.CancelledError, Exception):
            pass
    record = load_session_record(session_id)
    if not record:
        raise HTTPException(status_code=404, detail="No hay una sesión guardada con ese id.")
    video_key = record.get("videoKey")
    if video_key and video_key.startswith(LOCAL_VIDEO_PREFIX):
        try:
            local_video_path(video_key).unlink(missing_ok=True)
        except (OSError, ValueError) as exc:
            raise HTTPException(status_code=500, detail="No se pudo eliminar el video local.") from exc
    elif video_key:
        try:
            await asyncio.to_thread(delete_video_object, video_key)
        except RuntimeError as exc:
            detail = str(exc)
            if "AccessDenied" in detail or "not authorized" in detail.lower():
                raise HTTPException(
                    status_code=403,
                    detail="IAM no permite s3:DeleteObject. Agrégalo sobre recordings/* y vuelve a intentar.",
                ) from exc
            raise HTTPException(status_code=502, detail=detail) from exc
    try:
        delete_local_session(session_id)
    except OSError as exc:
        print(f"[WARN] No se vació del todo la carpeta local: {exc}")
    if load_session_record(session_id):
        raise HTTPException(status_code=500, detail="No se pudo quitar la sesión del historial.")
    return {"ok": True, "sessionId": session_id}


@app.post("/demo/transcribe")
async def demo_transcribe(file: UploadFile = File(...), language: str = Form("es")):
    """Microphone speed test for gpt-transcribe. One clip in, text and timing out."""
    data = await file.read()
    if len(data) < 44:
        raise HTTPException(status_code=400, detail="El audio llegó vacío.")
    lang = language if language in {"es", "en"} else "es"
    try:
        return await asyncio.to_thread(transcribe_speed_demo, data, lang)
    except Exception as exc:
        print(f"[ERROR] Demo gpt-transcribe: {exc}")
        detail = str(exc)
        if "401" in detail or "expired" in detail.lower() or "invalid_api_key" in detail.lower():
            raise HTTPException(
                status_code=401,
                detail="La clave de OpenAI expiró. Actualiza OPENAI_API_KEY en el archivo .env.",
            ) from exc
        raise HTTPException(status_code=502, detail="No se pudo transcribir ese fragmento.") from exc


@app.websocket("/ws/transcription")
async def websocket_transcription(websocket: WebSocket):
    """Live subtitles. The browser streams PCM and this process talks to gpt-live-transcribe."""
    await relay_live_transcription(websocket)

@app.websocket("/ws/pose-analysis")
async def websocket_pose_analysis(websocket: WebSocket):
    await websocket.accept()
    raw_session_id = (websocket.query_params.get("sessionId") or "").strip()
    session_id = safe_session_id(raw_session_id) if raw_session_id else None
    print(f"[INFO] Cliente conectado via WebSocket (pose session={session_id or 'anon'})")

    if cv2 is None or np is None:
        print("[WARN] Análisis de pose omitido: OpenCV/MediaPipe no disponible")
        unavailable = {
            "movilidad": "OpenCV/MediaPipe no disponible",
            "gesticulacion": "OpenCV/MediaPipe no disponible",
            "status_color": "#9ca3af",
            "orientacion": "OpenCV/MediaPipe no disponible",
            "orientacion_color": "#9ca3af",
            "de_espaldas": False,
            "expresion": "OpenCV/MediaPipe no disponible",
            "contacto_visual": "OpenCV/MediaPipe no disponible",
            "contacto_visual_color": "#9ca3af",
        }
        try:
            while True:
                await websocket.receive()
                await websocket.send_json(unavailable)
        except WebSocketDisconnect:
            print("[INFO] Cliente desconectado del WebSocket")
        return

    analyzer = PoseSessionAnalyzer()
    pose_frames = 0
    pose_slow = 0
    saved_frames = 0

    async def persist_metrics() -> None:
        nonlocal saved_frames
        if not session_id or pose_frames <= saved_frames:
            return
        summary = analyzer.summary()
        if not summary:
            return
        try:
            await asyncio.to_thread(attach_video_metrics, session_id, summary)
            saved_frames = pose_frames
            print(
                f"[INFO] Métricas de video guardadas ({session_id}): "
                f"frames={summary['framesAnalyzed']} frente={summary['orientation']['facingCameraPct']}% "
                f"contacto={summary['eyeContact']['directPct']}%",
                flush=True,
            )
        except Exception as exc:
            print(f"[WARN] No se guardaron métricas de video ({session_id}): {exc}", flush=True)

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break

            text = message.get("text")
            if text:
                try:
                    payload = json.loads(text)
                except json.JSONDecodeError:
                    continue
                if payload.get("type") == "flush":
                    await persist_metrics()
                continue

            bytes_data = message.get("bytes")
            if not bytes_data:
                continue

            frame_started = time.perf_counter()

            # Run JPEG decode + MediaPipe inference off the event loop so live audio
            # transcription and HTTP requests are never blocked by camera frames.
            detected = await asyncio.to_thread(
                run_mediapipe_detection,
                bytes_data,
                cv2_mod=cv2,
                np_mod=np,
                mp_mod=mp,
                pose_landmarker=pose_landmarker,
                face_landmarker=face_landmarker,
            )
            if detected is None:
                continue

            w, h, pose_result, face_result = detected
            metrics = analyzer.analyze(pose_result, face_result, w, h)

            pose_ms = int(round((time.perf_counter() - frame_started) * 1000))
            pose_frames += 1
            if pose_ms >= 200:
                pose_slow += 1
            if pose_ms >= 200 or pose_frames % 30 == 0:
                print(
                    f"[TIME pose] frame={pose_ms}ms bytes={len(bytes_data)} slow={pose_slow}/{pose_frames}",
                    flush=True,
                )

            await websocket.send_json(metrics)

    except WebSocketDisconnect:
        print("[INFO] Cliente desconectado del WebSocket")
    except Exception as e:
        print(f"[ERROR] Error en WebSocket: {e}")
    finally:
        await persist_metrics()

if __name__ == "__main__":
    import uvicorn
    # One process, no reloader. The reloader binds port 8000 twice on Windows and
    # drops the socket whenever Visual Studio or Next.js writes files.
    uvicorn.run(app, host=HOST, port=PORT, reload=False)
