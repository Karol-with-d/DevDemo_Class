import io
import json
import os
import queue
import re
import shutil
import tempfile
import threading
import time
from collections import Counter
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

VERBATIM_FILLER_CUE = "Eh, pues, o sea, este... bueno, la verdad es que, mmm, sí, ¿verdad?"
FILLER_KEYWORDS = [
    "eh",
    "este",
    "o sea",
    "pues",
    "verdad",
    "bueno",
    "digamos",
    "básicamente",
    "mmm",
]

MULETILLA_PATTERNS = [
    (r"\bo sea\b", "o sea"),
    (r"\bla verdad\b", "la verdad"),
    (r"\bes que\b", "es que"),
    (r"\beh+\b", "eh"),
    (r"\beste+\b", "este"),
    (r"\bpues\b", "pues"),
    (r"\bbueno\b", "bueno"),
    (r"\bverdad\b", "verdad"),
    (r"\bdigamos\b", "digamos"),
    (r"\bbásicamente\b", "básicamente"),
    (r"\bmmm+\b", "mmm"),
]


def extract_muletillas_from_text(text):
    """Extract and count Spanish filler words (muletillas) from verbatim text."""
    cleaned = str(text or "").lower()
    counts = Counter()
    for pattern, label in MULETILLA_PATTERNS:
        matches = re.findall(pattern, cleaned)
        if matches:
            counts[label] += len(matches)

    total_words = len(re.findall(r"\b\w+\b", cleaned))
    total_muletillas = sum(counts.values())
    ratio_pct = round((total_muletillas / total_words) * 100, 2) if total_words else 0.0
    breakdown = dict(counts.most_common())
    items = [{"phrase": phrase, "count": count} for phrase, count in counts.most_common()]

    return {
        "total": total_muletillas,
        "totalWords": total_words,
        "ratioPct": ratio_pct,
        "breakdown": breakdown,
        "items": items,
    }


def get_client():
    global _client
    if _client is None:
        from openai import OpenAI

        _client = OpenAI()
    return _client


def on_audio(indata, frames, time, status):
    audio_q.put(indata.copy())


def send_to_whisper(samples, sample_rate=SAMPLE_RATE, context=None, style_prompt=None):
    return _run_transcription(samples, sample_rate, context, style_prompt)["text"]


def _build_verbatim_prompt(style_prompt=None):
    base = (
        style_prompt
        or f"Transcripción literal en español. {VERBATIM_FILLER_CUE}"
    )
    if VERBATIM_FILLER_CUE.lower() not in base.lower():
        base = f"{base.strip()} {VERBATIM_FILLER_CUE}"
    return base[:500]


def _run_transcription(samples, sample_rate=SAMPLE_RATE, context=None, style_prompt=None):
    """Same live-recorder call as send_to_whisper, plus timings for the speed log."""
    samples = np.asarray(samples, dtype=np.float32)
    if samples.ndim > 1:
        samples = samples.mean(axis=1)
    audio_seconds = float(samples.size) / float(sample_rate or 1)
    if samples.size == 0:
        return {"text": "", "audioSeconds": 0, "apiMs": 0, "reason": "silence"}
    volume = float(np.sqrt(np.mean(samples ** 2)))
    if volume < 0.012:
        return {
            "text": "",
            "audioSeconds": round(audio_seconds, 2),
            "apiMs": 0,
            "reason": "silence",
        }
    previous = _as_previous(context if context is not None else full_text[-2:])
    buf = io.BytesIO()
    sf.write(buf, samples, sample_rate, format="WAV")
    buf.name = "chunk.wav"
    buf.seek(0)
    started = time.perf_counter()
    result = get_client().audio.transcriptions.create(
        model="gpt-transcribe",
        file=buf,
        prompt=_build_verbatim_prompt(style_prompt),
        temperature=0,
        extra_body={
            "languages": ["es"],
            "keywords": FILLER_KEYWORDS,
        },
    )
    api_ms = int(round((time.perf_counter() - started) * 1000))
    text = _without_prompt_echo(result.text)
    if not text:
        reason = "empty"
    elif _is_repeat_or_junk(text, previous):
        text = ""
        reason = "filtered"
    else:
        reason = "ok"
    return {
        "text": text,
        "audioSeconds": round(audio_seconds, 2),
        "apiMs": api_ms,
        "reason": reason,
    }


def _as_previous(context):
    if not context:
        return []
    if isinstance(context, str):
        return [context] if context.strip() else []
    return [str(item) for item in context if item]


def _normalize_caption(text):
    return " ".join(str(text or "").lower().split())


def _without_prompt_echo(text):
    """A hum or empty room sometimes comes back as the prompt itself."""
    cleaned = " ".join((text or "").split())
    lowered = _normalize_caption(cleaned)
    echo_prefixes = (
        "clase en español.",
        "clase en español",
        "transcripción en español.",
        "transcripción literal en español.",
        VERBATIM_FILLER_CUE.lower(),
    )
    for prefix in echo_prefixes:
        if lowered.startswith(prefix):
            cleaned = cleaned[len(prefix):].strip(" .")
            lowered = _normalize_caption(cleaned)
    if not cleaned or lowered == VERBATIM_FILLER_CUE.lower():
        return ""
    pieces = [piece.strip(" .¡!¿?").lower() for piece in cleaned.split(".")]
    pieces = [piece for piece in pieces if piece]
    if pieces and all(piece == "clase en español" for piece in pieces):
        return ""
    return cleaned


def _is_repeat_or_junk(text, previous):
    normalized = _normalize_caption(text)
    bare = normalized.strip(" .¡!¿?,")
    known_short_fillers = {"eh", "uh", "um", "mm", "mmm"}
    if len(bare) < 3 and bare not in known_short_fillers:
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
    return transcribe_wav_report(data, context, style_prompt)["text"]


def transcribe_wav_report(data, context="", style_prompt=None):
    started = time.perf_counter()
    incoming = io.BytesIO(data)
    samples, sample_rate = sf.read(incoming, dtype="float32", always_2d=False)
    decode_ms = int(round((time.perf_counter() - started) * 1000))
    report = _run_transcription(samples, int(sample_rate), context, style_prompt)
    report["decodeMs"] = decode_ms
    return report


def transcribe_speed_demo(data, language="es"):
    """One microphone clip through gpt-transcribe, with the API call timed.

    The class recorder filters repeats and prompt echoes. This path returns
    the model text as-is so a speed test shows what actually came back.
    """
    import time

    incoming = io.BytesIO(data)
    samples, sample_rate = sf.read(incoming, dtype="float32", always_2d=False)
    samples = np.asarray(samples, dtype=np.float32)
    if samples.ndim > 1:
        samples = samples.mean(axis=1)
    audio_seconds = float(samples.size) / float(sample_rate or 1)
    if samples.size == 0:
        return {"text": "", "apiMs": 0, "audioSeconds": 0, "skipped": True}
    volume = float(np.sqrt(np.mean(samples ** 2)))
    if volume < 0.012:
        print(
            f"[TIME demo] audio={audio_seconds:.2f}s api=0ms skipped=silence",
            flush=True,
        )
        return {
            "text": "",
            "apiMs": 0,
            "audioSeconds": round(audio_seconds, 2),
            "skipped": True,
        }
    buf = io.BytesIO()
    sf.write(buf, samples, int(sample_rate), format="WAV")
    buf.name = "demo.wav"
    buf.seek(0)
    started = time.perf_counter()
    result = get_client().audio.transcriptions.create(
        model="gpt-transcribe",
        file=buf,
        prompt=VERBATIM_FILLER_CUE,
        temperature=0,
        extra_body={
            "languages": [language],
            "keywords": FILLER_KEYWORDS,
        },
    )
    api_ms = int(round((time.perf_counter() - started) * 1000))
    text = " ".join((getattr(result, "text", "") or "").split())
    print(
        f"[TIME demo] audio={audio_seconds:.2f}s api={api_ms}ms text={len(text)}c",
        flush=True,
    )
    return {
        "text": text,
        "apiMs": api_ms,
        "audioSeconds": round(audio_seconds, 2),
        "skipped": False,
    }


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
    combined = " ".join(full_text)
    doc.add_paragraph(combined)

    muletillas = extract_muletillas_from_text(combined)
    if muletillas["total"] > 0:
        doc.add_heading("Muletillas detectadas", level=2)
        summary = ", ".join(
            f"{item['phrase']} ({item['count']})" for item in muletillas["items"]
        )
        doc.add_paragraph(
            f"Total: {muletillas['total']} ({muletillas['ratioPct']}% de las palabras) — {summary}"
        )

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
        self.vocabulary = []
        self._vocabulary_ready = False
        self.muletillas = {
            "total": 0,
            "totalWords": 0,
            "ratioPct": 0.0,
            "breakdown": {},
            "items": [],
        }
        self._muletillas_ready = False
        self.video_key = None
        self.directory = os.path.join(RECORDINGS_DIR, self.session_id)
        os.makedirs(self.directory, exist_ok=True)

    def prompt_context(self):
        return [segment["text"] for segment in self.segments[-2:]]

    def style_prompt(self):
        parts = [
            f"Transcripción literal en español de una evaluación técnica. {VERBATIM_FILLER_CUE}"
        ]
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
        self._vocabulary_ready = False
        self._muletillas_ready = False
        self.write()
        return segment

    def analyze_vocabulary(self):
        """spaCy + glossary once per session, after Whisper finishes."""
        if self._vocabulary_ready:
            return self.vocabulary
        try:
            from vocab_extractor import extract_technical_terms

            spoken = " ".join(segment["text"] for segment in self.segments)
            self.vocabulary = extract_technical_terms(spoken, self.technology)
        except Exception as exc:
            print(f"[WARN] No se extrajo vocabulario técnico: {exc}")
            self.vocabulary = []
        self._vocabulary_ready = True
        return self.vocabulary

    def analyze_muletillas(self):
        """Extract filler words (muletillas) once per session after transcription finishes."""
        if self._muletillas_ready:
            return self.muletillas
        spoken = " ".join(segment["text"] for segment in self.segments)
        try:
            import vocab_extractor

            if hasattr(vocab_extractor, "extract_muletillas"):
                self.muletillas = vocab_extractor.extract_muletillas(spoken)
            else:
                self.muletillas = extract_muletillas_from_text(spoken)
        except Exception as exc:
            print(f"[WARN] Usando extractor local de muletillas: {exc}")
            self.muletillas = extract_muletillas_from_text(spoken)
        self._muletillas_ready = True
        return self.muletillas

    def write(self, analyze=False):
        if analyze:
            self.analyze_vocabulary()
            self.analyze_muletillas()
        payload = {
            "sessionId": self.session_id,
            "candidateName": self.candidate_name,
            "evaluatorName": self.evaluator_name,
            "technology": self.technology,
            "complexity": self.complexity,
            "savedAt": datetime.now().isoformat(timespec="seconds"),
            "segments": self.segments,
            "vocabulary": self.vocabulary,
            "muletillas": self.muletillas,
            "videoKey": self.video_key,
            "savedInSystem": bool(self.video_key),
        }
        json_path = os.path.join(self.directory, "transcript.json")
        vtt_path = os.path.join(self.directory, "transcript.vtt")
        txt_path = os.path.join(self.directory, "transcript.txt")
        saved = load_session_record(self.session_id) or {}
        for field in ("evaluation", "evaluationStorage", "evaluatedAt", "videoKey", "savedInSystem"):
            if field in saved:
                payload[field] = saved[field]
        _write_session_json(json_path, payload)
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
            "vocabulary": self.vocabulary,
            "muletillas": self.muletillas,
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
        if self.muletillas.get("total", 0) > 0:
            doc.add_heading("Muletillas detectadas", level=2)
            summary = ", ".join(
                f"{item['phrase']} ({item['count']})"
                for item in self.muletillas.get("items", [])
            )
            doc.add_paragraph(
                f"Total: {self.muletillas['total']} ({self.muletillas['ratioPct']}% de las palabras) — {summary}"
            )
        doc.save(path)


def _session_json_path(session_id):
    return os.path.join(RECORDINGS_DIR, safe_session_id(session_id), "transcript.json")


def _write_session_json(path, payload):
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=os.path.dirname(path), delete=False,
        ) as handle:
            temporary_path = handle.name
            json.dump(payload, handle, ensure_ascii=False, indent=2)
        os.replace(temporary_path, path)
        temporary_path = None
    finally:
        if temporary_path is not None:
            os.unlink(temporary_path)


def load_session_record(session_id):
    path = _session_json_path(session_id)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError, UnicodeError):
        return None
    return payload if isinstance(payload, dict) else None


def attach_video_key(session_id, video_key, *, metadata=None):
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
        **(metadata or {}),
    }
    payload["sessionId"] = session_id
    payload["videoKey"] = video_key
    payload["savedInSystem"] = True
    payload["savedAt"] = payload.get("savedAt") or datetime.now().isoformat(timespec="seconds")
    _write_session_json(path, payload)
    return payload


def attach_evaluation_report(session_id, evaluation_data, *, source):
    session_id = safe_session_id(session_id)
    directory = os.path.join(RECORDINGS_DIR, session_id)
    os.makedirs(directory, exist_ok=True)
    path = _session_json_path(session_id)
    payload = load_session_record(session_id) or {
        "sessionId": session_id,
        "candidateName": evaluation_data.get("candidateName", "Candidato"),
        "evaluatorName": evaluation_data.get("evaluatorName", ""),
        "technology": evaluation_data.get("technology", ""),
        "complexity": evaluation_data.get("complexity", ""),
        "segments": [],
    }
    evaluated_at = datetime.now().isoformat(timespec="seconds")
    payload.setdefault("savedAt", evaluated_at)
    payload["evaluation"] = evaluation_data
    payload["evaluationStorage"] = source
    payload["evaluatedAt"] = evaluated_at
    _write_session_json(path, payload)
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
                "segments": payload.get("segments") or [],
                "vocabulary": payload.get("vocabulary") or [],
                "muletillas": payload.get("muletillas") or {},
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
