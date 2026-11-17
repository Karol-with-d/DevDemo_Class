import io
import json
import os
import queue
import shutil
import threading
from datetime import datetime

import numpy as np
import soundfile as sf
from dotenv import load_dotenv

load_dotenv()

SAMPLE_RATE = 16000
CHUNK_SECONDS = 10
audio_q = queue.Queue()
full_text = []
_client = None

RECORDINGS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "recordings")


def get_client():
    global _client
    if _client is None:
        from openai import OpenAI

        _client = OpenAI()
    return _client


def on_audio(indata, frames, time, status):
    audio_q.put(indata.copy())


def send_to_whisper(samples, sample_rate=SAMPLE_RATE, context=None, style_prompt=None):
    samples = np.asarray(samples, dtype=np.float32)
    if samples.ndim > 1:
        samples = samples.mean(axis=1)
    if samples.size == 0:
        return ""
    volume = float(np.sqrt(np.mean(samples ** 2)))
    if volume < 0.012:
        return ""
    previous = _as_previous(context if context is not None else full_text[-2:])
    buf = io.BytesIO()
    sf.write(buf, samples, sample_rate, format="WAV")
    buf.name = "chunk.wav"
    buf.seek(0)
    result = get_client().audio.transcriptions.create(
        model="gpt-4o-mini-transcribe",
        file=buf,
        language="es",
        prompt=(style_prompt or "Transcripción en español. Solo el audio de este fragmento.")[:500],
    )
    text = _without_prompt_echo(result.text)
    if _is_repeat_or_junk(text, previous):
        return ""
    return text


def _as_previous(context):
    if not context:
        return []
    if isinstance(context, str):
        return [context] if context.strip() else []
    return [item for item in context if item]


def _normalize_caption(text):
    return " ".join((text or "").lower().split())


def _without_prompt_echo(text):
    """A hum or empty room sometimes comes back as the prompt itself."""
    cleaned = " ".join((text or "").split())
    lowered = _normalize_caption(cleaned)
    for prefix in ("clase en español.", "clase en español", "transcripción en español."):
        if lowered.startswith(prefix):
            cleaned = cleaned[len(prefix):].strip(" .")
            lowered = _normalize_caption(cleaned)
    if not cleaned:
        return ""
    pieces = [piece.strip(" .¡!¿?").lower() for piece in cleaned.split(".")]
    pieces = [piece for piece in pieces if piece]
    if pieces and all(piece == "clase en español" for piece in pieces):
        return ""
    return cleaned


def _is_repeat_or_junk(text, previous):
    normalized = _normalize_caption(text)
    if len(normalized) < 3:
        return True
    junk = (
        "gracias por ver",
        "subtítulos realizados",
        "amara.org",
        "música de fondo",
        "aplausos",
        "like y suscríbete",
    )
    if any(item in normalized for item in junk):
        return True
    last = _normalize_caption(previous[-1] if previous else "")
    if not last:
        return False
    if normalized == last:
        return True
    if last in normalized or normalized in last:
        return True
    words_a, words_b = set(normalized.split()), set(last.split())
    if not words_a or not words_b:
        return False
    overlap = len(words_a & words_b) / max(len(words_a), len(words_b))
    return overlap >= 0.8


def transcribe_wav_bytes(data, context="", style_prompt=None):
    incoming = io.BytesIO(data)
    samples, sample_rate = sf.read(incoming, dtype="float32", always_2d=False)
    return send_to_whisper(
        samples,
        int(sample_rate),
        context=context,
        style_prompt=style_prompt,
    )


def transcribe_loop(stop_event):
    buffer = np.zeros(0, dtype=np.float32)
    silence = 0
    while not (stop_event.is_set() and audio_q.empty()):
        try:
            block = audio_q.get(timeout=0.5).flatten()
        except queue.Empty:
            continue
        buffer = np.concatenate([buffer, block])
        loud = np.sqrt(np.mean(block ** 2)) > 0.01
        silence = 0 if loud else silence + len(block)
        seconds = len(buffer) / SAMPLE_RATE
        paused = silence > SAMPLE_RATE * 0.4  # 0.4 s of quiet
        if (seconds > 1.5 and paused) or seconds > 8:
            text = send_to_whisper(buffer)
            if text:
                print(text, flush=True)
                full_text.append(text)
            buffer = np.zeros(0, dtype=np.float32)
            silence = 0
    if len(buffer) > SAMPLE_RATE:
        text = send_to_whisper(buffer)
        if text:
            full_text.append(text)


def save_docx(path=None):
    from docx import Document

    path = path or f"transcripcion_{datetime.now():%Y%m%d_%H%M}.docx"
    doc = Document()
    doc.add_heading("Transcripción", level=1)
    doc.add_paragraph(" ".join(full_text))
    doc.save(path)
    return path


def start():
    import sounddevice as sd

    stop_event = threading.Event()
    stream = sd.InputStream(
        device=1, samplerate=SAMPLE_RATE, channels=1, dtype="float32", callback=on_audio
    )
    worker = threading.Thread(target=transcribe_loop, args=(stop_event,))
    stream.start()
    worker.start()
    return stream, stop_event, worker


def stop(stream, stop_event, worker):
    stream.stop()
    stop_event.set()
    worker.join()
    return save_docx()


def safe_session_id(value):
    raw = (value or "").strip()
    cleaned = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in raw)
    return cleaned[:80] or datetime.now().strftime("SES-%Y%m%d_%H%M%S")


def clock_label(seconds):
    total_ms = max(0, int(round(float(seconds) * 1000)))
    hours, total_ms = divmod(total_ms, 3_600_000)
    minutes, total_ms = divmod(total_ms, 60_000)
    secs, millis = divmod(total_ms, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02}.{millis:03}"


class TranscriptSession:
    """Timed subtitles for one camera recording."""

    def __init__(self, session_id, candidate_name="", evaluator_name="", technology="", complexity=""):
        self.session_id = safe_session_id(session_id)
        self.candidate_name = candidate_name or "Candidato"
        self.evaluator_name = evaluator_name or ""
        self.technology = technology or ""
        self.complexity = complexity or ""
        self.segments = []
        self.video_key = None
        self.directory = os.path.join(RECORDINGS_DIR, self.session_id)
        os.makedirs(self.directory, exist_ok=True)

    def prompt_context(self):
        return [segment["text"] for segment in self.segments[-2:]]

    def style_prompt(self):
        parts = ["Transcripción en español de una evaluación técnica. Solo este fragmento."]
        if self.technology:
            parts.append(f"Tema: {self.technology}.")
        return " ".join(parts)

    def add(self, start, end, text):
        spoken = " ".join((text or "").split())
        if not spoken:
            return None
        previous = [segment["text"] for segment in self.segments[-2:]]
        if _is_repeat_or_junk(spoken, previous):
            return None
        start = max(0.0, float(start))
        end = max(start + 0.3, float(end))
        segment = {"start": round(start, 3), "end": round(end, 3), "text": spoken}
        self.segments.append(segment)
        self.write()
        return segment

    def write(self):
        payload = {
            "sessionId": self.session_id,
            "candidateName": self.candidate_name,
            "evaluatorName": self.evaluator_name,
            "technology": self.technology,
            "complexity": self.complexity,
            "savedAt": datetime.now().isoformat(timespec="seconds"),
            "segments": self.segments,
            "videoKey": self.video_key,
            "savedInSystem": bool(self.video_key),
        }
        json_path = os.path.join(self.directory, "transcript.json")
        vtt_path = os.path.join(self.directory, "transcript.vtt")
        txt_path = os.path.join(self.directory, "transcript.txt")
        with open(json_path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
        with open(vtt_path, "w", encoding="utf-8") as handle:
            handle.write(self.to_vtt())
        with open(txt_path, "w", encoding="utf-8") as handle:
            handle.write(self.to_text())

        docx_path = os.path.join(self.directory, "transcript.docx")
        try:
            self.write_docx(docx_path)
        except Exception as exc:
            print(f"[WARN] No se guardó el docx: {exc}")
            docx_path = None

        return {
            "jsonPath": json_path,
            "vttPath": vtt_path,
            "txtPath": txt_path,
            "docxPath": docx_path,
            "segments": self.segments,
        }

    def to_vtt(self):
        lines = ["WEBVTT", ""]
        for index, segment in enumerate(self.segments, start=1):
            lines.append(str(index))
            lines.append(f"{clock_label(segment['start'])} --> {clock_label(segment['end'])}")
            lines.append(segment["text"])
            lines.append("")
        return "\n".join(lines)

    def to_text(self):
        heading = f"Transcripción de {self.candidate_name}"
        rows = [heading, ""]
        for segment in self.segments:
            rows.append(f"[{clock_label(segment['start'])}] {segment['text']}")
        return "\n".join(rows) + "\n"

    def write_docx(self, path):
        from docx import Document

        doc = Document()
        doc.add_heading(f"Transcripción — {self.candidate_name}", level=1)
        if self.evaluator_name or self.technology:
            doc.add_paragraph(
                " · ".join(
                    part
                    for part in (
                        f"Evaluador: {self.evaluator_name}" if self.evaluator_name else "",
                        self.technology,
                        self.complexity,
                    )
                    if part
                )
            )
        if not self.segments:
            doc.add_paragraph("No se detectó voz durante la grabación.")
        for segment in self.segments:
            doc.add_paragraph(f"[{clock_label(segment['start'])}] {segment['text']}")
        doc.save(path)


def _session_json_path(session_id):
    return os.path.join(RECORDINGS_DIR, safe_session_id(session_id), "transcript.json")


def load_session_record(session_id):
    path = _session_json_path(session_id)
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def attach_video_key(session_id, video_key):
    session_id = safe_session_id(session_id)
    directory = os.path.join(RECORDINGS_DIR, session_id)
    os.makedirs(directory, exist_ok=True)
    path = _session_json_path(session_id)
    payload = load_session_record(session_id) or {
        "sessionId": session_id,
        "candidateName": "Candidato",
        "evaluatorName": "",
        "technology": "",
        "complexity": "",
        "segments": [],
    }
    payload["sessionId"] = session_id
    payload["videoKey"] = video_key
    payload["savedInSystem"] = True
    payload["savedAt"] = payload.get("savedAt") or datetime.now().isoformat(timespec="seconds")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
    return payload


def list_saved_recordings():
    items = []
    if not os.path.isdir(RECORDINGS_DIR):
        return items
    for name in os.listdir(RECORDINGS_DIR):
        payload = load_session_record(name)
        if not payload or not isinstance(payload, dict):
            continue
        items.append(
            {
                "sessionId": payload.get("sessionId") or name,
                "candidateName": payload.get("candidateName") or "Candidato",
                "evaluatorName": payload.get("evaluatorName") or "",
                "technology": payload.get("technology") or "",
                "complexity": payload.get("complexity") or "",
                "savedAt": payload.get("savedAt") or "",
                "videoKey": payload.get("videoKey"),
                "savedInSystem": bool(payload.get("videoKey")),
                "segmentCount": len(payload.get("segments") or []),
            }
        )
    items.sort(key=lambda item: item.get("savedAt") or "", reverse=True)
    return items


def delete_local_session(session_id):
    directory = os.path.join(RECORDINGS_DIR, safe_session_id(session_id))
    if not os.path.isdir(directory):
        return
    json_path = os.path.join(directory, "transcript.json")
    # Drop the catalog entry first so the library hides the session even if
    # OneDrive/Windows still locks the folder (WinError 5 on rmdir).
    if os.path.isfile(json_path):
        try:
            os.remove(json_path)
        except OSError:
            try:
                os.replace(json_path, json_path + ".deleted")
            except OSError:
                pass
    shutil.rmtree(directory, ignore_errors=True)


if __name__ == "__main__":
    s, e, w = start()
    input("Hablando... presiona Enter para terminar\n")
    print("Guardado en:", stop(s, e, w))
