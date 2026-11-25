import os
from datetime import datetime

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from dotenv import load_dotenv

from transcriber import safe_session_id

load_dotenv()

REQUIRED_ENV = (
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_REGION",
    "AWS_BUCKET_NAME",
)
PRESIGN_EXPIRES = 3600
_REPO_ROOT = os.path.dirname(os.path.abspath(__file__))


def has_aws_settings():
    return all(os.getenv(name) for name in REQUIRED_ENV)


def _require_settings():
    missing = [name for name in REQUIRED_ENV if not os.getenv(name)]
    if missing:
        raise RuntimeError(
            "Faltan variables de AWS en .env: " + ", ".join(missing)
        )
    return {
        "region": os.environ["AWS_REGION"],
        "bucket": os.environ["AWS_BUCKET_NAME"],
    }


def _local_path_for_key(key):
    key = str(key)
    if not key.startswith("recordings/") or ".." in key.split("/"):
        raise RuntimeError("Clave de video no válida.")
    path = os.path.normpath(os.path.join(_REPO_ROOT, key))
    root = os.path.normpath(os.path.join(_REPO_ROOT, "recordings"))
    if not path.startswith(root + os.sep):
        raise RuntimeError("Clave de video no válida.")
    return path


def _client(region):
    return boto3.client("s3", region_name=region)


def media_type_for(filename="", content_type=""):
    raw = (content_type or "").split(";")[0].strip().lower()
    if raw in ("video/webm", "video/mp4"):
        return raw
    name = str(filename or "")
    if name.endswith(".mp4") or "mp4" in raw:
        return "video/mp4"
    return "video/webm"


def upload_video_bytes(data, session_id, content_type="video/webm", filename="recording.webm"):
    session = safe_session_id(session_id)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    media_type = media_type_for(filename, content_type)
    ext = "mp4" if media_type == "video/mp4" else "webm"
    key = f"recordings/{session}/{stamp}.{ext}"

    if not has_aws_settings():
        local_path = _local_path_for_key(key)
        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        with open(local_path, "wb") as handle:
            handle.write(data)
        return {
            "video_url": f"/video?key={key}",
            "key": key,
            "content_type": media_type,
            "stored": "local",
        }

    settings = _require_settings()
    client = _client(settings["region"])
    try:
        client.put_object(
            Bucket=settings["bucket"],
            Key=key,
            Body=data,
            ContentType=media_type,
            ContentDisposition="inline",
        )
        video_url = client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": settings["bucket"],
                "Key": key,
                "ResponseContentType": media_type,
                "ResponseContentDisposition": "inline",
            },
            ExpiresIn=PRESIGN_EXPIRES,
        )
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Error de S3: {exc}") from exc

    return {"video_url": video_url, "key": key, "content_type": media_type}


def read_video_object(key):
    # Videos grabados sin credenciales AWS quedan en disco con el mismo key.
    # Servir el archivo local cuando exista aunque S3 ya esté configurado.
    if not has_aws_settings() or os.path.isfile(_local_path_for_key(key)):
        local_path = _local_path_for_key(key)
        if not os.path.isfile(local_path):
            raise RuntimeError("El video no existe en el almacenamiento local.")
        with open(local_path, "rb") as handle:
            return handle.read(), media_type_for(key)

    if not str(key).startswith("recordings/"):
        raise RuntimeError("Clave de video no válida.")
    settings = _require_settings()
    client = _client(settings["region"])
    try:
        obj = client.get_object(Bucket=settings["bucket"], Key=key)
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Error de S3: {exc}") from exc
    body = obj["Body"].read()
    content_type = media_type_for(key, obj.get("ContentType", ""))
    return body, content_type


def delete_video_object(key):
    local_path = _local_path_for_key(key)
    if os.path.isfile(local_path):
        os.remove(local_path)
    if not has_aws_settings():
        return

    if not str(key).startswith("recordings/"):
        raise RuntimeError("Clave de video no válida.")
    settings = _require_settings()
    client = _client(settings["region"])
    try:
        client.delete_object(Bucket=settings["bucket"], Key=key)
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Error de S3: {exc}") from exc
