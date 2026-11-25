from concurrent.futures import ThreadPoolExecutor
import io
import json
import os
import queue
import re
import shutil
import subprocess
import tempfile
import threading
import time
from collections import Counter
from datetime import datetime
from pathlib import Path

import numpy as np
import soundfile as sf
from dotenv import load_dotenv

load_dotenv()

SAMPLE_RATE = 16000
CHUNK_SECONDS = 10
MAX_TRANSCRIPTION_BYTES = 24 * 1024 * 1024
LONG_AUDIO_CHUNK_SECONDS = 600
LONG_AUDIO_OVERLAP_SECONDS = 5
audio_q = queue.Queue()
full_text = []
_client = None
_session_locks_guard = threading.Lock()
_session_locks = {}
_verbose_json_supported = None


def _session_lock(session_id):
    key = safe_session_id(session_id)
    with _session_locks_guard:
        lock = _session_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _session_locks[key] = lock
        return lock

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

    def write(self, analyze=False, transcript_source="live", force=False):
        with _session_lock(self.session_id):
            saved = load_session_record(self.session_id) or {}
            json_path = os.path.join(self.directory, "transcript.json")
            vtt_path = os.path.join(self.directory, "transcript.vtt")
            txt_path = os.path.join(self.directory, "transcript.txt")
            docx_path = os.path.join(self.directory, "transcript.docx")

            # Never let a late live-caption flush overwrite an authoritative final transcript.
            if not force and transcript_source != "final" and saved.get("transcriptSource") == "final":
                return {
                    "jsonPath": json_path if os.path.isfile(json_path) else None,
                    "vttPath": vtt_path if os.path.isfile(vtt_path) else None,
                    "txtPath": txt_path if os.path.isfile(txt_path) else None,
                    "docxPath": docx_path if os.path.isfile(docx_path) else None,
                    "segments": saved.get("segments") or [],
                    "vocabulary": saved.get("vocabulary") or [],
                    "muletillas": saved.get("muletillas") or {},
                }

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
                "transcriptSource": transcript_source,
                "segments": self.segments,
                "vocabulary": self.vocabulary,
                "muletillas": self.muletillas,
                "videoKey": self.video_key,
                "savedInSystem": bool(self.video_key),
            }
            for field in (
                "evaluation",
                "evaluationStorage",
                "evaluatedAt",
                "videoKey",
                "savedInSystem",
                "videoMetrics",
            ):
                if field in saved:
                    payload[field] = saved[field]
            _write_session_json(json_path, payload)
            with open(vtt_path, "w", encoding="utf-8") as handle:
                handle.write(self.to_vtt())
            with open(txt_path, "w", encoding="utf-8") as handle:
                handle.write(self.to_text())

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
    with _session_lock(session_id):
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
    with _session_lock(session_id):
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


def attach_video_metrics(session_id, video_metrics, *, metadata=None):
    """Persist aggregated MediaPipe video metrics on the session record."""
    if not video_metrics or not isinstance(video_metrics, dict):
        return None
    session_id = safe_session_id(session_id)
    directory = os.path.join(RECORDINGS_DIR, session_id)
    os.makedirs(directory, exist_ok=True)
    path = _session_json_path(session_id)
    with _session_lock(session_id):
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
        payload["videoMetrics"] = video_metrics
        payload["savedAt"] = payload.get("savedAt") or datetime.now().isoformat(timespec="seconds")
        _write_session_json(path, payload)
        return payload


def _extension_for_media(filename="", content_type=""):
    raw_name = str(filename or "").lower()
    raw_type = (content_type or "").split(";")[0].strip().lower()
    for ext in (".webm", ".mp4", ".m4a", ".ogg", ".opus", ".mp3", ".wav"):
        if raw_name.endswith(ext):
            return ".ogg" if ext == ".opus" else ext
    if "mp4" in raw_type or "m4a" in raw_type:
        return ".mp4"
    if "ogg" in raw_type or "opus" in raw_type:
        return ".ogg"
    if "mpeg" in raw_type or "mp3" in raw_type:
        return ".mp3"
    if "wav" in raw_type:
        return ".wav"
    return ".webm"


def _probe_duration_seconds(path):
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return 0.0
    try:
        proc = subprocess.run(
            [
                ffprobe,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        value = float((proc.stdout or "").strip())
        return value if value > 0 and np.isfinite(value) else 0.0
    except Exception:
        return 0.0


def _extract_audio_with_ffmpeg(input_path, workdir):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return None
    # Fast lossless demux first (strips video track with zero re-encoding).
    copy_ext = ".m4a" if str(input_path).lower().endswith(".mp4") else ".webm"
    copy_out = Path(workdir) / f"extracted{copy_ext}"
    proc = subprocess.run(
        [ffmpeg, "-y", "-i", str(input_path), "-vn", "-c:a", "copy", str(copy_out)],
        capture_output=True,
        timeout=60,
        check=False,
    )
    if proc.returncode == 0 and copy_out.is_file() and copy_out.stat().st_size > 0:
        return copy_out

    # Fallback: transparent 64 kbps mono Opus in OGG/WebM or MP3.
    transcode_out = Path(workdir) / "extracted.mp3"
    proc = subprocess.run(
        [
            ffmpeg,
            "-y",
            "-i",
            str(input_path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "24000",
            "-b:a",
            "64k",
            str(transcode_out),
        ],
        capture_output=True,
        timeout=120,
        check=False,
    )
    if proc.returncode == 0 and transcode_out.is_file() and transcode_out.stat().st_size > 0:
        return transcode_out
    return None


def _split_audio_with_ffmpeg(input_path, workdir, duration_seconds):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return []
    total = duration_seconds if duration_seconds > 0 else _probe_duration_seconds(input_path)
    if total <= 0:
        return []
    step = max(60.0, float(LONG_AUDIO_CHUNK_SECONDS - LONG_AUDIO_OVERLAP_SECONDS))
    window = float(LONG_AUDIO_CHUNK_SECONDS)
    chunks = []
    start = 0.0
    index = 0
    while start < total - 0.5:
        chunk_end = min(total, start + window)
        out_path = Path(workdir) / f"chunk_{index:03d}.mp3"
        proc = subprocess.run(
            [
                ffmpeg,
                "-y",
                "-ss",
                f"{start:.3f}",
                "-t",
                f"{window:.3f}",
                "-i",
                str(input_path),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "24000",
                "-b:a",
                "64k",
                str(out_path),
            ],
            capture_output=True,
            timeout=120,
            check=False,
        )
        if proc.returncode == 0 and out_path.is_file() and out_path.stat().st_size > 0:
            chunks.append((out_path, start, chunk_end))
        if chunk_end >= total:
            break
        start += step
        index += 1
    return chunks


def _build_recording_prompt(technology=""):
    parts = [
        f"Transcripción literal en español de una evaluación técnica. {VERBATIM_FILLER_CUE}"
    ]
    if technology:
        parts.append(f"Tema: {technology}.")
    return " ".join(parts)[:500]


def _call_full_transcription(audio_bytes, filename, prompt):
    """Call OpenAI file transcription, using verbose_json only on models that support it."""
    global _verbose_json_supported
    model = os.getenv("OPENAI_TRANSCRIBE_MODEL") or "gpt-transcribe"
    client = get_client().with_options(timeout=180, max_retries=1)
    common = {
        "model": model,
        "prompt": prompt,
        "temperature": 0,
        "extra_body": {
            "languages": ["es"],
            "keywords": FILLER_KEYWORDS,
        },
    }

    # gpt-transcribe returns JSON text only; skip the probe to avoid a wasted round-trip.
    supports_verbose = _verbose_json_supported is not False and model != "gpt-transcribe"
    if supports_verbose:
        buf = io.BytesIO(audio_bytes)
        buf.name = filename
        try:
            result = client.audio.transcriptions.create(
                file=buf,
                response_format="verbose_json",
                timestamp_granularities=["segment"],
                **common,
            )
            _verbose_json_supported = True
            return result
        except Exception as exc:
            detail = str(exc).lower()
            if (
                "response_format" in detail
                or "verbose_json" in detail
                or "timestamp_granularit" in detail
                or "unsupported" in detail
                or "400" in detail
            ):
                _verbose_json_supported = False
            else:
                raise

    buf = io.BytesIO(audio_bytes)
    buf.name = filename
    return client.audio.transcriptions.create(file=buf, **common)


def _normalize_word(word):
    return re.sub(r"[^\wáéíóúüñ]+", "", (word or "").lower())


def _trim_overlapping_prefix(prev_text, next_text, max_words=28):
    """Remove duplicated boundary words introduced by overlapping audio chunks."""
    prev_words = (prev_text or "").split()
    next_words = (next_text or "").split()
    if len(prev_words) < 2 or len(next_words) < 2:
        return next_text
    tail = [_normalize_word(w) for w in prev_words[-max_words:]]
    head = [_normalize_word(w) for w in next_words[:max_words]]
    best = 0
    limit = min(len(tail), len(head))
    for size in range(limit, 1, -1):
        if tail[-size:] == head[:size]:
            best = size
            break
    if best > 0:
        return " ".join(next_words[best:]).strip()
    return next_text


def _split_into_sentences(text):
    cleaned = " ".join((text or "").split())
    if not cleaned:
        return []
    raw_parts = re.split(r"(?<=[.!?…])\s+", cleaned)
    merged = []
    for part in raw_parts:
        part = part.strip()
        if not part:
            continue
        if merged and len(merged[-1]) < 40 and len(merged[-1]) + len(part) < 150:
            merged[-1] = f"{merged[-1]} {part}"
        else:
            merged.append(part)
    return merged


def _segments_from_text(text, window_start, window_end):
    sentences = _split_into_sentences(text)
    if not sentences:
        return []
    start = max(0.0, float(window_start))
    span = max(0.3, float(window_end) - start)
    weights = [max(1, len(sentence)) for sentence in sentences]
    total_weight = float(sum(weights))
    segments = []
    cursor = start
    for index, (sentence, weight) in enumerate(zip(sentences, weights)):
        seg_end = start + span if index == len(sentences) - 1 else cursor + span * (weight / total_weight)
        seg_end = max(cursor + 0.3, seg_end)
        segments.append({
            "start": round(cursor, 3),
            "end": round(seg_end, 3),
            "text": sentence,
        })
        cursor = seg_end
    return segments


def _extract_result_segments(result, offset_seconds, window_start, window_end):
    raw_segments = getattr(result, "segments", None)
    if raw_segments:
        parsed = []
        for seg in raw_segments:
            seg_text = _without_prompt_echo(
                seg.get("text") if isinstance(seg, dict) else getattr(seg, "text", "")
            )
            if not seg_text:
                continue
            seg_start = seg.get("start") if isinstance(seg, dict) else getattr(seg, "start", 0.0)
            seg_end = seg.get("end") if isinstance(seg, dict) else getattr(seg, "end", seg_start)
            start = max(0.0, float(seg_start or 0.0) + float(offset_seconds))
            end = max(start + 0.3, float(seg_end or start) + float(offset_seconds))
            parsed.append({"start": round(start, 3), "end": round(end, 3), "text": seg_text})
        if parsed:
            return parsed

    text = _without_prompt_echo(getattr(result, "text", "") or "")
    if not text:
        return []
    result_duration = getattr(result, "duration", None)
    effective_end = window_end
    if isinstance(result_duration, (int, float)) and result_duration > 0:
        effective_end = max(window_start + 0.3, float(offset_seconds) + float(result_duration))
    return _segments_from_text(text, window_start, effective_end)


def transcribe_recording_file(
    *,
    audio_bytes=None,
    audio_filename="audio.webm",
    audio_content_type="audio/webm",
    video_path=None,
    video_bytes=None,
    video_filename="recording.webm",
    video_content_type="video/webm",
    technology="",
    duration_seconds=0.0,
    live_segments=None,
):
    """Run a high-accuracy full-recording transcription pass over complete uncut audio."""
    started = time.perf_counter()
    prompt = _build_recording_prompt(technology)
    live_segments = live_segments or []
    live_first_start = float(live_segments[0]["start"]) if live_segments else 0.0
    live_last_end = max((float(seg.get("end") or seg.get("start") or 0.0) for seg in live_segments), default=0.0)

    with tempfile.TemporaryDirectory(prefix="transcribe_") as workdir:
        source_path = None
        prepared_bytes = None
        prepared_filename = None

        if audio_bytes:
            ext = _extension_for_media(audio_filename, audio_content_type)
            prepared_filename = f"recording{ext}"
            if len(audio_bytes) <= MAX_TRANSCRIPTION_BYTES:
                prepared_bytes = audio_bytes
            else:
                source_path = Path(workdir) / prepared_filename
                source_path.write_bytes(audio_bytes)
        else:
            if video_path is not None and Path(video_path).is_file():
                source_path = Path(video_path)
            elif video_bytes:
                ext = _extension_for_media(video_filename, video_content_type)
                source_path = Path(workdir) / f"video{ext}"
                source_path.write_bytes(video_bytes)

            if source_path is None:
                return []

            extracted = _extract_audio_with_ffmpeg(source_path, workdir)
            if extracted is not None:
                source_path = extracted

            if source_path.stat().st_size <= MAX_TRANSCRIPTION_BYTES:
                prepared_bytes = source_path.read_bytes()
                prepared_filename = source_path.name

        total_duration = float(duration_seconds or 0.0)
        if total_duration <= 0 and source_path is not None:
            total_duration = _probe_duration_seconds(source_path)
        if total_duration <= 0 and live_last_end > 0:
            total_duration = live_last_end

        if prepared_bytes is not None:
            result = _call_full_transcription(prepared_bytes, prepared_filename or "audio.webm", prompt)
            raw_text = _without_prompt_echo(getattr(result, "text", "") or "")
            if total_duration <= 0:
                word_count = len(raw_text.split())
                total_duration = max(1.0, word_count / 2.5)
            start_anchor = 0.0
            if live_first_start > 0.5 and live_first_start < total_duration * 0.5:
                start_anchor = max(0.0, live_first_start - 0.3)
            segments = _extract_result_segments(result, 0.0, start_anchor, total_duration)
        else:
            # Oversized audio (>24 MB): split with 5s overlap and transcribe chunks concurrently.
            chunk_specs = _split_audio_with_ffmpeg(source_path, workdir, total_duration)
            if not chunk_specs:
                raise RuntimeError(
                    "El archivo supera 24 MB y ffmpeg no está disponible para dividir el audio."
                )

            def _transcribe_chunk(spec):
                chunk_path, chunk_start, chunk_end = spec
                chunk_result = _call_full_transcription(chunk_path.read_bytes(), chunk_path.name, prompt)
                return chunk_start, chunk_end, chunk_result

            max_workers = min(3, len(chunk_specs))
            with ThreadPoolExecutor(max_workers=max_workers) as pool:
                chunk_results = list(pool.map(_transcribe_chunk, chunk_specs))

            segments = []
            prev_chunk_text = ""
            for chunk_start, chunk_end, chunk_result in chunk_results:
                chunk_segs = _extract_result_segments(chunk_result, chunk_start, chunk_start, chunk_end)
                while prev_chunk_text and chunk_segs:
                    trimmed_first = _trim_overlapping_prefix(prev_chunk_text, chunk_segs[0]["text"])
                    if trimmed_first == chunk_segs[0]["text"]:
                        break
                    if trimmed_first:
                        chunk_segs[0]["text"] = trimmed_first
                        break
                    chunk_segs.pop(0)
                if chunk_segs:
                    prev_chunk_text = " ".join(seg["text"] for seg in chunk_segs)
                    segments.extend(chunk_segs)

    elapsed_ms = int(round((time.perf_counter() - started) * 1000))
    total_chars = sum(len(seg["text"]) for seg in segments)
    print(
        f"[TIME final-transcribe] api={elapsed_ms}ms segments={len(segments)} chars={total_chars}",
        flush=True,
    )
    return segments


def replace_session_transcript(session_id, segments, *, metadata=None):
    """Atomically overwrite a session's transcript with the clean full-recording pass."""
    session_id = safe_session_id(session_id)
    saved = load_session_record(session_id) or {}
    meta = metadata or {}
    session = TranscriptSession(
        session_id=session_id,
        candidate_name=meta.get("candidateName") or saved.get("candidateName") or "Candidato",
        evaluator_name=meta.get("evaluatorName") or saved.get("evaluatorName") or "",
        technology=meta.get("technology") or saved.get("technology") or "",
        complexity=meta.get("complexity") or saved.get("complexity") or "",
    )
    session.video_key = saved.get("videoKey")
    session.segments = [
        {
            "start": round(max(0.0, float(seg["start"])), 3),
            "end": round(max(float(seg["start"]) + 0.3, float(seg.get("end", seg["start"]))), 3),
            "text": " ".join(str(seg["text"]).split()),
        }
        for seg in (segments or [])
        if str(seg.get("text") or "").strip()
    ]
    return session.write(analyze=True, transcript_source="final", force=True)


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
                "videoMetrics": payload.get("videoMetrics"),
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
