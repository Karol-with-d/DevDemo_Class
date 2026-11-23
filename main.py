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
from fastapi.responses import Response
import asyncio
import json
import math
import os

from transcriber import (
    TranscriptSession,
    attach_evaluation_report,
    attach_video_key,
    delete_local_session,
    list_saved_recordings,
    load_session_record,
    transcribe_wav_bytes,
)
from s3_storage import (
    delete_video_object,
    read_evaluation_json,
    read_video_object,
    upload_evaluation_json,
    upload_video_bytes,
)

# The latest socket for a recording wins. A replaced socket must not overwrite its subtitles.
active_transcripts = {}

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
    sessionId: str = Form(""),
):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="El archivo de video está vacío.")
    try:
        result = await asyncio.to_thread(
            upload_video_bytes,
            data,
            sessionId,
            file.content_type or "video/webm",
            file.filename or "recording.webm",
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        print(f"[ERROR] Subida a S3: {exc}")
        raise HTTPException(status_code=502, detail="No se pudo subir el video a S3.") from exc
    attach_video_key(sessionId, result["key"])
    result["savedInSystem"] = True
    return result


@app.get("/recordings")
def get_recordings():
    return {"recordings": list_saved_recordings()}


@app.post("/evaluations/{session_id}")
async def save_evaluation(session_id: str, payload: dict):
    if not payload:
        raise HTTPException(status_code=400, detail="Los datos de evaluación están vacíos.")
    try:
        s3_res = await asyncio.to_thread(upload_evaluation_json, session_id, payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        print(f"[ERROR] Guardando evaluación en S3: {exc}")
        raise HTTPException(status_code=502, detail="No se pudo guardar la evaluación en S3.") from exc

    attach_evaluation_report(session_id, payload)
    return {"ok": True, "sessionId": session_id, **s3_res}


@app.get("/evaluations/{session_id}")
async def get_evaluation(session_id: str):
    try:
        s3_eval = await asyncio.to_thread(read_evaluation_json, session_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if s3_eval is not None:
        return {"ok": True, "source": "s3", "evaluation": s3_eval}

    local_record = load_session_record(session_id)
    if local_record and local_record.get("evaluation"):
        return {"ok": True, "source": "local", "evaluation": local_record["evaluation"]}

    return {"ok": True, "source": None, "evaluation": None}


@app.get("/video")
async def play_video(key: str, download: bool = False):
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
    record = load_session_record(session_id)
    if not record:
        raise HTTPException(status_code=404, detail="No hay una sesión guardada con ese id.")
    video_key = record.get("videoKey")
    if video_key:
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
            raise HTTPException(
                status_code=500,
                detail="El video se quitó de S3, pero Windows bloqueó la carpeta local. Recarga la biblioteca.",
            ) from exc
    return {"ok": True, "sessionId": session_id}


@app.websocket("/ws/transcription")
async def websocket_transcription(websocket: WebSocket):
    """Live subtitles for the camera recording. Audio arrives as WAV chunks."""
    await websocket.accept()
    print("[INFO] Transcripción conectada")
    session = None
    pending = None
    whisper_auth_failed = False

    async def reply_done():
        await websocket.send_json({"type": "chunk-done"})

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break

            text_frame = message.get("text")
            if text_frame:
                try:
                    payload = json.loads(text_frame)
                except json.JSONDecodeError:
                    continue

                kind = payload.get("type")
                if kind == "start":
                    session = TranscriptSession(
                        session_id=payload.get("sessionId", ""),
                        candidate_name=payload.get("candidateName", ""),
                        evaluator_name=payload.get("evaluatorName", ""),
                        technology=payload.get("technology", ""),
                        complexity=payload.get("complexity", ""),
                    )
                    active_transcripts[session.session_id] = session
                    pending = None
                    await websocket.send_json({"type": "ready", "sessionId": session.session_id})
                elif kind == "chunk":
                    pending = payload
                elif kind == "stop":
                    owns_session = (
                        session is not None
                        and active_transcripts.get(session.session_id) is session
                    )
                    saved = session.write(analyze=True) if owns_session else None
                    await websocket.send_json({"type": "saved", **(saved or {"segments": []})})
                    break
                continue

            audio = message.get("bytes")
            if audio is None or session is None:
                continue
            if active_transcripts.get(session.session_id) is not session:
                await reply_done()
                continue

            meta = pending or {}
            pending = None
            if whisper_auth_failed:
                await reply_done()
                continue
            try:
                spoken = await asyncio.to_thread(
                    transcribe_wav_bytes,
                    audio,
                    session.prompt_context(),
                    session.style_prompt(),
                )
            except Exception as exc:
                print(f"[ERROR] Whisper: {exc}")
                detail = str(exc)
                if "401" in detail or "expired" in detail.lower() or "invalid_api_key" in detail.lower():
                    whisper_auth_failed = True
                    await websocket.send_json({
                        "type": "error",
                        "message": "La clave de OpenAI expiró. Actualiza OPENAI_API_KEY en el archivo .env.",
                    })
                else:
                    await websocket.send_json({
                        "type": "error",
                        "message": "No se pudo transcribir ese fragmento.",
                    })
                continue

            if spoken:
                segment = session.add(meta.get("start", 0), meta.get("end", 0), spoken)
                if segment:
                    print(f"[SUB] {segment['start']:.1f}s {segment['text']}", flush=True)
                    await websocket.send_json({"type": "subtitle", **segment})
                    continue
            await reply_done()
    except WebSocketDisconnect:
        print("[INFO] Transcripción desconectada")
    except Exception as exc:
        print(f"[ERROR] Error en transcripción: {exc}")
    finally:
        if session is not None and active_transcripts.get(session.session_id) is session:
            session.write(analyze=True)
            active_transcripts.pop(session.session_id, None)

def _giro_desde_rostro(landmarks, matrix=None):
    """Head turn from the face mesh. Finding a face is not the same as facing the camera."""
    if matrix is not None:
        # About 26 degrees. A profile like the screenshots is well past this.
        yaw = math.atan2(float(matrix[0][2]), float(matrix[2][2]))
        if abs(yaw) >= 0.45:
            return "perfil"
    if not landmarks or len(landmarks) < 455:
        return None
    nose = landmarks[1]
    left_eye, right_eye = landmarks[33], landmarks[263]
    left_cheek, right_cheek = landmarks[234], landmarks[454]
    chin = landmarks[152]
    width = max(abs(right_cheek.x - left_cheek.x), 1e-4)
    yaw = abs(nose.x - (left_cheek.x + right_cheek.x) / 2.0) / width
    depth = abs(left_cheek.z - right_cheek.z)
    eye_span = max(abs(right_eye.x - left_eye.x), 1e-4)
    pitch = (nose.y - (left_eye.y + right_eye.y) / 2.0) / eye_span
    if yaw >= 0.30 or depth >= 0.08 or (yaw >= 0.20 and depth >= 0.045):
        return "perfil"
    if pitch >= 2.0 or nose.y >= 0.86 or chin.y >= 0.97:
        return "abajo"
    return None


def _giro_desde_pose(landmarks):
    """Backup when the face mesh drops: profile ears, or the head sunk to the frame edge."""
    if not landmarks or len(landmarks) < 9:
        return None
    nose = landmarks[0]
    left_eye, right_eye = landmarks[2], landmarks[5]
    left_ear, right_ear = landmarks[7], landmarks[8]
    if nose.y >= 0.82 or (
        left_eye.visibility > 0.3
        and right_eye.visibility > 0.3
        and left_eye.y >= 0.75
        and right_eye.y >= 0.75
    ):
        return "abajo"
    if left_eye.visibility > 0.3 and right_eye.visibility > 0.3:
        span = max(abs(left_eye.x - right_eye.x), 0.015)
        pitch = (nose.y - (left_eye.y + right_eye.y) / 2.0) / span
        if pitch >= 2.4:
            return "abajo"
    if left_ear.visibility > 0.45 and right_ear.visibility > 0.45 and nose.visibility > 0.35:
        span = max(abs(left_ear.x - right_ear.x), 1e-4)
        asym = abs(abs(nose.x - left_ear.x) - abs(nose.x - right_ear.x)) / span
        if asym >= 0.85:
            return "perfil"
    return None


_MENSAJE_GIRO = {
    "espaldas": ("¡Atención! De espaldas a la cámara", "Sin contacto visual (De espaldas)"),
    "perfil": ("De perfil: no mira a la cámara", "Sin contacto visual (De perfil)"),
    "abajo": ("Cabeza baja o fuera de cuadro", "Sin contacto visual (Cabeza baja)"),
}


@app.websocket("/ws/pose-analysis")
async def websocket_pose_analysis(websocket: WebSocket):
    await websocket.accept()
    print("[INFO] Cliente conectado via WebSocket")

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

    prev_center_x, prev_center_y = None, None
    smooth_center_x, smooth_center_y = None, None
    historial_movimiento = []
    historial_espaldas = []
    espalda_activa = False
    motivo_sostenido = None
    frames_sin_pose = 0
    VENTANA_FRAMES = 90
    MIN_MUESTRAS_MOVIMIENTO = 30
    # About three camera frames. One noisy frame must not raise the banner.
    VENTANA_ESPALDAS = 4
    # Pose landmarks jitter while the teacher stands still. Movement has to clear
    # that noise, and a one-frame leap is a bad detection, not walking.
    UMBRAL_MOVIMIENTO = 0.10
    UMBRAL_SALTO = 0.65
    SUAVIZADO = 0.35

    try:
        while True:
            # Recibir fotograma binario de la cámara
            bytes_data = await websocket.receive_bytes()
            np_arr = np.frombuffer(bytes_data, np.uint8)
            frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

            if frame is None:
                continue

            h, w, _ = frame.shape
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)

            # Ejecutar inferencia para pose y rostro
            pose_result = pose_landmarker.detect(mp_image) if pose_landmarker else None
            face_result = face_landmarker.detect(mp_image) if face_landmarker else None

            # Valores por defecto
            alerta_movilidad = "Analizando..."
            alerta_gestos = "Buscando docente..."
            color_alerta = "#9ca3af"

            alerta_orientacion = "Buscando docente..."
            color_orientacion = "#9ca3af"
            es_de_espaldas = False
            alerta_expresion = "Buscando rostro..."
            alerta_contacto = "Buscando rostro..."
            color_contacto = "#9ca3af"

            pose_detected = pose_result and pose_result.pose_landmarks and len(pose_result.pose_landmarks) > 0
            face_detected = face_result and face_result.face_landmarks and len(face_result.face_landmarks) > 0
            frame_de_espaldas = False

            if pose_detected:
                landmarks = pose_result.pose_landmarks[0]

                # Puntos anatómicos principales
                nose = landmarks[0]
                left_ear, right_ear = landmarks[7], landmarks[8]
                shoulder_left, shoulder_right = landmarks[11], landmarks[12]
                wrist_left, wrist_right = landmarks[15], landmarks[16]
                hip_left, hip_right = landmarks[23], landmarks[24]

                # --- 1. DETECCIÓN DE ORIENTACIÓN: DAR LA ESPALDA A LA CÁMARA ---
                shoulders_visible = (shoulder_left.visibility > 0.35 and shoulder_right.visibility > 0.35)
                # En vista frontal: shoulder_left.x > shoulder_right.x
                # De espaldas: shoulder_left.x < shoulder_right.x (inversión de hombros)
                shoulder_diff = shoulder_left.x - shoulder_right.x

                # Comprobación de profundidad relativa de la nariz
                nose_behind_ears = (nose.z > left_ear.z and nose.z > right_ear.z) or (nose.visibility < 0.25)

                if shoulders_visible and shoulder_diff < -0.04:
                    frame_de_espaldas = True
                elif (not face_detected) and nose_behind_ears and shoulders_visible:
                    frame_de_espaldas = True

                # --- 2. EVALUACIÓN DE GESTOS ---
                altura_cadera = (hip_left.y + hip_right.y) / 2 if (hip_left.visibility > 0.3 and hip_right.visibility > 0.3) else 0.85
                manos_elevadas = (wrist_left.visibility > 0.4 and wrist_left.y < altura_cadera) or \
                                 (wrist_right.visibility > 0.4 and wrist_right.y < altura_cadera)
                alerta_gestos = "Buen uso de gesticulación" if manos_elevadas else "Gestos limitados (Manos bajas)"

                # --- 3. EVALUACIÓN DE MOVILIDAD ---
                frames_sin_pose = 0
                hombros_confiables = shoulder_left.visibility > 0.5 and shoulder_right.visibility > 0.5
                ancho_hombros = max(math.hypot((shoulder_left.x - shoulder_right.x) * w, (shoulder_left.y - shoulder_right.y) * h), 1.0)
                center_x = ((shoulder_left.x + shoulder_right.x) / 2) * w
                center_y = ((shoulder_left.y + shoulder_right.y) / 2) * h

                if hombros_confiables:
                    if smooth_center_x is None or prev_center_x is None:
                        smooth_center_x, smooth_center_y = center_x, center_y
                        prev_center_x, prev_center_y = center_x, center_y
                    else:
                        candidato_x = SUAVIZADO * center_x + (1.0 - SUAVIZADO) * smooth_center_x
                        candidato_y = SUAVIZADO * center_y + (1.0 - SUAVIZADO) * smooth_center_y
                        desplazamiento_relativo = math.hypot(
                            candidato_x - prev_center_x, candidato_y - prev_center_y
                        ) / ancho_hombros

                        if desplazamiento_relativo >= UMBRAL_SALTO:
                            smooth_center_x, smooth_center_y = center_x, center_y
                            prev_center_x, prev_center_y = center_x, center_y
                        else:
                            smooth_center_x, smooth_center_y = candidato_x, candidato_y
                            prev_center_x, prev_center_y = candidato_x, candidato_y
                            historial_movimiento.append(1 if desplazamiento_relativo > UMBRAL_MOVIMIENTO else 0)
                            if len(historial_movimiento) > VENTANA_FRAMES:
                                historial_movimiento.pop(0)

                if len(historial_movimiento) >= MIN_MUESTRAS_MOVIMIENTO:
                    movimiento_promedio = sum(historial_movimiento) / len(historial_movimiento)

                    if movimiento_promedio > 0.40:
                        alerta_movilidad = "Excelente dinamismo corporal"
                        color_alerta = "#22c55e" # Verde
                    elif movimiento_promedio > 0.15:
                        alerta_movilidad = "Movilidad moderada"
                        color_alerta = "#eab308" # Amarillo
                    else:
                        alerta_movilidad = "Docente muy estático"
                        color_alerta = "#ef4444" # Rojo
                else:
                    alerta_movilidad = "Analizando movilidad..."
                    color_alerta = "#9ca3af"
            else:
                frames_sin_pose += 1
                if frames_sin_pose > 8:
                    prev_center_x, prev_center_y = None, None
                    smooth_center_x, smooth_center_y = None, None
                    historial_movimiento.clear()
                    if not face_detected:
                        historial_espaldas.clear()
                        espalda_activa = False
                        motivo_sostenido = None

            # A face mesh used to force "facing the audience". Profile and a head
            # dropped to the bottom of the frame are the cases that must alert.
            matriz_rostro = None
            if face_detected and getattr(face_result, "facial_transformation_matrixes", None):
                matriz_rostro = face_result.facial_transformation_matrixes[0]
            giro_rostro = _giro_desde_rostro(face_result.face_landmarks[0], matriz_rostro) if face_detected else None
            giro_pose = _giro_desde_pose(landmarks) if pose_detected else None
            if frame_de_espaldas:
                motivo_frame = "espaldas"
            elif giro_rostro:
                motivo_frame = giro_rostro
            elif giro_pose:
                motivo_frame = giro_pose
            else:
                motivo_frame = None

            if pose_detected or face_detected:
                historial_espaldas.append(1 if motivo_frame else 0)
                if len(historial_espaldas) > VENTANA_ESPALDAS:
                    historial_espaldas.pop(0)
                votos_espaldas = sum(historial_espaldas)
                if not espalda_activa and len(historial_espaldas) >= 3 and votos_espaldas >= 3:
                    espalda_activa = True
                elif espalda_activa and votos_espaldas <= 1:
                    espalda_activa = False
                    if not motivo_frame:
                        motivo_sostenido = None
                if motivo_frame:
                    motivo_sostenido = motivo_frame

            motivo_visible = motivo_frame or (motivo_sostenido if espalda_activa else None)
            if espalda_activa and motivo_visible:
                es_de_espaldas = True
                alerta_orientacion = _MENSAJE_GIRO[motivo_visible][0]
                color_orientacion = "#ef4444"
            elif motivo_visible == "perfil":
                alerta_orientacion = "De perfil (Giro parcial)"
                color_orientacion = "#eab308"
            elif motivo_visible == "abajo":
                alerta_orientacion = "Cabeza baja o fuera de cuadro"
                color_orientacion = "#eab308"
            elif motivo_visible == "espaldas":
                alerta_orientacion = "Girando de espaldas..."
                color_orientacion = "#eab308"
            elif face_detected or pose_detected:
                alerta_orientacion = "Frente a la audiencia"
                color_orientacion = "#22c55e"

            # --- 4. MÉTRICAS FACIALES Y CONTACTO VISUAL ---
            if motivo_visible:
                alerta_contacto = _MENSAJE_GIRO[motivo_visible][1]
                color_contacto = "#ef4444" if espalda_activa else "#eab308"
                if motivo_visible == "espaldas":
                    alerta_expresion = "No visible (De espaldas)"
            if motivo_visible != "espaldas" and face_detected and face_result.face_blendshapes and len(face_result.face_blendshapes) > 0:
                blendshapes = {b.category_name: b.score for b in face_result.face_blendshapes[0]}

                # Sonrisa y amabilidad
                smile_score = (blendshapes.get("mouthSmileLeft", 0) + blendshapes.get("mouthSmileRight", 0)) / 2.0
                if smile_score > 0.20:
                    alerta_expresion = "Expresión cordial / Sonrisa"
                else:
                    alerta_expresion = "Expresión atenta / Neutral"

                # Parpadeo / Ojos cerrados
                ojos_cerrados = blendshapes.get("eyeBlinkLeft", 0) > 0.65 and blendshapes.get("eyeBlinkRight", 0) > 0.65

                # Mirada lateral coordinada (ambos ojos mirando marcadamente a un lado)
                mira_izq = blendshapes.get("eyeLookOutLeft", 0) > 0.55 and blendshapes.get("eyeLookInRight", 0) > 0.55
                mira_der = blendshapes.get("eyeLookOutRight", 0) > 0.55 and blendshapes.get("eyeLookInLeft", 0) > 0.55
                mira_arriba = blendshapes.get("eyeLookUpLeft", 0) > 0.65 and blendshapes.get("eyeLookUpRight", 0) > 0.65
                mira_abajo = blendshapes.get("eyeLookDownLeft", 0) > 0.75 and blendshapes.get("eyeLookDownRight", 0) > 0.75

                if not motivo_visible:
                    if ojos_cerrados:
                        alerta_contacto = "Ojos cerrados"
                        color_contacto = "#eab308" # Amarillo
                    elif mira_izq or mira_der or mira_arriba or mira_abajo:
                        alerta_contacto = "Mirada desviada"
                        color_contacto = "#eab308" # Amarillo
                    else:
                        alerta_contacto = "Contacto visual directo"
                        color_contacto = "#22c55e" # Verde
            elif motivo_visible:
                pass
            elif pose_detected:
                # Fallback con Pose Landmarker (cuando FaceLandmarker no detecta por distancia o luz)
                eye_left, eye_right = landmarks[2], landmarks[5]
                nose = landmarks[0]
                ojos_visibles = (eye_left.visibility > 0.35 and eye_right.visibility > 0.35 and nose.visibility > 0.35)

                if ojos_visibles:
                    mid_eye_x = (eye_left.x + eye_right.x) / 2.0
                    ancho_ojos = max(abs(eye_left.x - eye_right.x), 0.005)
                    desviacion_nariz = abs(nose.x - mid_eye_x) / ancho_ojos

                    if desviacion_nariz < 0.35:
                        alerta_contacto = "Contacto visual directo"
                        color_contacto = "#22c55e" # Verde
                    else:
                        alerta_contacto = "Mirada lateral / Giro de cabeza"
                        color_contacto = "#eab308" # Amarillo
                    alerta_expresion = "Expresión atenta"
                else:
                    alerta_contacto = "Rostro parcialmente cubierto"
                    color_contacto = "#eab308"
                    alerta_expresion = "Expresión no disponible"
            else:
                alerta_contacto = "Sin contacto visual"
                color_contacto = "#9ca3af"
                alerta_expresion = "Rostro no detectado"

            # Emitir métricas completas actualizadas a la web
            await websocket.send_json({
                "movilidad": alerta_movilidad,
                "gesticulacion": alerta_gestos,
                "status_color": color_alerta,
                "orientacion": alerta_orientacion,
                "orientacion_color": color_orientacion,
                "de_espaldas": es_de_espaldas,
                "expresion": alerta_expresion,
                "contacto_visual": alerta_contacto,
                "contacto_visual_color": color_contacto
            })

    except WebSocketDisconnect:
        print("[INFO] Cliente desconectado del WebSocket")
    except Exception as e:
        print(f"[ERROR] Error en WebSocket: {e}")

if __name__ == "__main__":
    import uvicorn
    # One process, no reloader. The reloader binds port 8000 twice on Windows and
    # drops the socket whenever Visual Studio or Next.js writes files.
    uvicorn.run(app, host=HOST, port=PORT, reload=False)