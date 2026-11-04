import io
import json
import os
import queue
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


def send_to_whisper(samples, sample_rate=SAMPLE_RATE, context=None):
    samples = np.asarray(samples, dtype=np.float32)
    if samples.ndim > 1:
        samples = samples.mean(axis=1)
    if samples.size == 0:
        return ""
    volume = float(np.sqrt(np.mean(samples ** 2)))
    if volume < 0.01:  # silence, don't send it
        return ""
    if context is None:
        context = " ".join(full_text[-3:])
    buf = io.BytesIO()
    sf.write(buf, samples, sample_rate, format="WAV")
    buf.name = "chunk.wav"
    buf.seek(0)
    result = get_client().audio.transcriptions.create(
        model="gpt-4o-mini-transcribe",
        file=buf,
        language="es",
        prompt=("Clase en español. " + context)[-500:],
    )
    return _without_prompt_echo(result.text)


def _without_prompt_echo(text):
    """A hum or empty room sometimes comes back as the prompt itself."""
    cleaned = " ".join((text or "").split())
    pieces = [piece.strip(" .¡!¿?").lower() for piece in cleaned.split(".")]
    pieces = [piece for piece in pieces if piece]
    if pieces and all(piece == "clase en español" for piece in pieces):
        return ""
    return cleaned


def transcribe_wav_bytes(data, context=""):
    incoming = io.BytesIO(data)
    samples, sample_rate = sf.read(incoming, dtype="float32", always_2d=False)
    return send_to_whisper(samples, int(sample_rate), context=context)


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
        paused = silence > SAMPLE_RATE * 0.6  # 0.6 s of quiet
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
        self.directory = os.path.join(RECORDINGS_DIR, self.session_id)
        os.makedirs(self.directory, exist_ok=True)

    def prompt_context(self):
        return " ".join(segment["text"] for segment in self.segments[-3:])

    def add(self, start, end, text):
        spoken = " ".join((text or "").split())
        if not spoken:
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


if __name__ == "__main__":
    s, e, w = start()
    input("Hablando... presiona Enter para terminar\n")
    print("Guardado en:", stop(s, e, w))
