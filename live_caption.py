"""Proxy the browser microphone to a gpt-live-transcribe session."""

import asyncio
import json
import os
import time

import websockets

from transcriber import TranscriptSession

OPENAI_REALTIME = "wss://api.openai.com/v1/realtime?intent=transcription"
DELTA = "conversation.item.input_audio_transcription.delta"
COMPLETED = "conversation.item.input_audio_transcription.completed"
FAILED = "conversation.item.input_audio_transcription.failed"


def _auth_error(detail):
    text = str(detail).lower()
    return "401" in text or "expired" in text or "invalid_api_key" in text


async def relay_live_transcription(browser):
    """One recording socket. Audio is 24 kHz PCM16, already base64 from the browser."""
    await browser.accept()
    print("[INFO] Transcripción en vivo conectada", flush=True)
    session = None
    wrote = False

    try:
        while True:
            message = await browser.receive()
            if message.get("type") == "websocket.disconnect":
                break
            text = message.get("text")
            if not text:
                continue
            try:
                payload = json.loads(text)
            except json.JSONDecodeError:
                continue
            if payload.get("type") != "start":
                continue
            session = TranscriptSession(
                session_id=payload.get("sessionId", ""),
                candidate_name=payload.get("candidateName", ""),
                evaluator_name=payload.get("evaluatorName", ""),
                technology=payload.get("technology", ""),
                complexity=payload.get("complexity", ""),
            )
            wrote = True
            await _run_session(browser, session)
            break
    except Exception as exc:
        print(f"[ERROR] Transcripción en vivo: {exc}", flush=True)
        if _auth_error(exc):
            await _send(browser, {
                "type": "error",
                "message": "La clave de OpenAI expiró. Actualiza OPENAI_API_KEY en el archivo .env.",
            })
    finally:
        if session is not None and not wrote:
            session.write(analyze=True)


async def _run_session(browser, session):
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        await _send(browser, {
            "type": "error",
            "message": "Falta OPENAI_API_KEY en el archivo .env.",
        })
        return

    pending = []
    item_ids = []
    finals = {}
    failed = set()
    partials = {}
    send_lock = asyncio.Lock()

    async with websockets.connect(
        OPENAI_REALTIME,
        additional_headers={"Authorization": f"Bearer {api_key}"},
        max_size=4 * 1024 * 1024,
    ) as upstream:
        ready = asyncio.Event()

        async def send_upstream(payload):
            async with send_lock:
                await upstream.send(json.dumps(payload))

        async def finish_ready():
            while pending and item_ids:
                item_id = item_ids[0]
                if item_id not in finals and item_id not in failed:
                    return
                meta = pending.pop(0)
                item_ids.pop(0)
                elapsed = int(round((time.perf_counter() - meta["t0"]) * 1000))
                if item_id in failed:
                    print(f"[TIME live] final api={elapsed}ms reason=failed", flush=True)
                    await _send(browser, {"type": "chunk-done", "timing": {"apiMs": elapsed, "reason": "failed"}})
                    continue
                spoken = finals.pop(item_id, "")
                segment = session.add(meta["start"], meta["end"], spoken)
                reason = "ok" if segment else "filtered"
                print(
                    f"[TIME live] final api={elapsed}ms "
                    f"audio={max(0.0, meta['end'] - meta['start']):.2f}s "
                    f"chars={len(spoken)} reason={reason}",
                    flush=True,
                )
                if segment:
                    print(f"[SUB] {segment['start']:.1f}s {segment['text']}", flush=True)
                    await _send(browser, {"type": "subtitle", **segment, "timing": {"apiMs": elapsed, "reason": reason}})
                else:
                    await _send(browser, {"type": "chunk-done", "timing": {"apiMs": elapsed, "reason": reason}})
                await send_upstream({
                    "type": "session.update",
                    "session": {
                        "type": "transcription",
                        "audio": {
                            "input": {
                                "transcription": _transcription_config(session),
                            }
                        },
                    },
                })

        async def read_upstream():
            async for raw in upstream:
                event = json.loads(raw)
                kind = event.get("type")
                if kind == "session.updated":
                    ready.set()
                elif kind == "error":
                    detail = (event.get("error") or {}).get("message") or "Error de transcripción"
                    print(f"[ERROR] gpt-live-transcribe: {detail}", flush=True)
                    await _send(browser, {"type": "error", "message": detail})
                    if len(pending) > len(item_ids):
                        pending.pop(0)
                        await _send(browser, {"type": "chunk-done", "timing": {"reason": "error"}})
                elif kind == "input_audio_buffer.committed":
                    item_id = event.get("item_id")
                    if item_id:
                        item_ids.append(item_id)
                        await finish_ready()
                elif kind == DELTA:
                    item_id = event.get("item_id") or ""
                    partials[item_id] = partials.get(item_id, "") + (event.get("delta") or "")
                    await _send(browser, {"type": "partial", "text": partials[item_id]})
                elif kind == COMPLETED:
                    item_id = event.get("item_id") or ""
                    finals[item_id] = event.get("transcript") or ""
                    await finish_ready()
                elif kind == FAILED:
                    item_id = event.get("item_id") or ""
                    failed.add(item_id)
                    await finish_ready()

        await send_upstream({
            "type": "session.update",
            "session": {
                "type": "transcription",
                "audio": {
                    "input": {
                        "format": {"type": "audio/pcm", "rate": 24000},
                        "transcription": _transcription_config(session),
                        "turn_detection": None,
                    }
                },
            },
        })
        reader = asyncio.create_task(read_upstream())
        stored = False
        try:
            try:
                await asyncio.wait_for(ready.wait(), timeout=10)
            except asyncio.TimeoutError:
                await _send(browser, {
                    "type": "error",
                    "message": "GPT Live Transcribe no confirmó la sesión.",
                })
                return

            await _send(browser, {"type": "ready", "sessionId": session.session_id})
            while True:
                message = await browser.receive()
                if message.get("type") == "websocket.disconnect":
                    break
                text = message.get("text")
                if not text:
                    continue
                try:
                    payload = json.loads(text)
                except json.JSONDecodeError:
                    continue
                kind = payload.get("type")
                if kind == "audio" and payload.get("pcm"):
                    await send_upstream({
                        "type": "input_audio_buffer.append",
                        "audio": payload["pcm"],
                    })
                elif kind == "commit":
                    pending.append({
                        "start": float(payload.get("start") or 0),
                        "end": float(payload.get("end") or 0),
                        "t0": time.perf_counter(),
                    })
                    await send_upstream({"type": "input_audio_buffer.commit"})
                elif kind == "reset":
                    # "Reiniciar": descarta lo transcrito pero la sesión sigue.
                    pending.clear()
                    session.reset()
                elif kind == "discard":
                    # "Cancelar": no persistir nada; el cliente borra la carpeta.
                    stored = True
                    break
                elif kind == "stop":
                    saved = session.write(analyze=True)
                    stored = True
                    await _send(browser, {"type": "saved", **(saved or {"segments": []})})
                    break
        finally:
            reader.cancel()
            if not stored:
                session.write(analyze=True)


def _transcription_config(session):
    recent = session.prompt_context()
    prompt = session.style_prompt()
    if recent:
        prompt = f"{prompt} Lo anterior: {recent[-1]}"
    return {
        "model": "gpt-live-transcribe",
        "prompt": prompt[:1000],
        "languages": ["es"],
        "delay": "low",
    }


async def _send(browser, payload):
    try:
        await browser.send_json(payload)
    except Exception:
        pass
