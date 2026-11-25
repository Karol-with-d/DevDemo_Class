import re
import shutil
from pathlib import Path
from urllib.parse import urlencode
from uuid import uuid4

import transcriber
from s3_storage import media_type_for


LOCAL_VIDEO_PREFIX = "local/"


def local_video_path(key: str) -> Path:
    parts = key.split("/")
    if len(parts) != 3:
        raise ValueError("Clave de video local no válida.")
    prefix, session_id, filename = parts
    if (
        prefix + "/" != LOCAL_VIDEO_PREFIX
        or not session_id
        or session_id != transcriber.safe_session_id(session_id)
        or not re.fullmatch(r"[a-f0-9]{32}\.(webm|mp4)", filename)
    ):
        raise ValueError("Clave de video local no válida.")

    root = Path(transcriber.RECORDINGS_DIR).resolve()
    path = root / session_id / filename
    if path.resolve() != path:
        raise ValueError("Ruta de video local no válida.")
    return path


def store_local_video(file, session_id, content_type, filename):
    media_type = media_type_for(filename, content_type)
    extension = "mp4" if media_type == "video/mp4" else "webm"
    key = f"{LOCAL_VIDEO_PREFIX}{session_id}/{uuid4().hex}.{extension}"
    path = local_video_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    output = path.open("xb")
    try:
        with output:
            shutil.copyfileobj(file, output)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return {
        "key": key,
        "video_url": "/video?" + urlencode({"key": key}),
        "content_type": media_type,
    }
