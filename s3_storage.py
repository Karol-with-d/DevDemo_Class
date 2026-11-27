import json
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


def is_s3_configured():
    return all(os.getenv(name) for name in REQUIRED_ENV)


def _env_flag(name):
    return (os.getenv(name) or "").strip().lower() in {"1", "true", "yes", "on"}


def allow_local_video_fallback():
    """Opt-in local video storage fallback when AWS S3 is not configured."""
    return _env_flag("ALLOW_LOCAL_FALLBACK") or _env_flag("ALLOW_LOCAL_VIDEO_FALLBACK")


def allow_local_evaluation_fallback():
    """Opt-in local evaluation storage fallback when AWS S3 is not configured."""
    return _env_flag("ALLOW_LOCAL_FALLBACK") or _env_flag("ALLOW_LOCAL_EVALUATION_FALLBACK")


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
    settings = _require_settings()
    session = safe_session_id(session_id)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    media_type = media_type_for(filename, content_type)
    ext = "mp4" if media_type == "video/mp4" else "webm"
    key = f"recordings/{session}/{stamp}.{ext}"
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


def _client_error_code(exc):
    if isinstance(exc, ClientError):
        return str(exc.response.get("Error", {}).get("Code", ""))
    return ""


def _is_access_denied(exc):
    code = _client_error_code(exc)
    text = str(exc).lower()
    return code in {"AccessDenied", "403", "AllAccessDisabled"} or "accessdenied" in text or "not authorized" in text


def list_objects_under_prefix(prefix):
    """Lista keys bajo recordings/{session}/. None si IAM no tiene s3:ListBucket."""
    raw = str(prefix or "")
    if not raw.startswith("recordings/") or ".." in raw:
        raise RuntimeError("Prefijo de S3 no válido.")
    settings = _require_settings()
    client = _client(settings["region"])
    keys = []
    token = None
    try:
        while True:
            kwargs = {"Bucket": settings["bucket"], "Prefix": raw, "MaxKeys": 1000}
            if token:
                kwargs["ContinuationToken"] = token
            response = client.list_objects_v2(**kwargs)
            for item in response.get("Contents") or []:
                key = item.get("Key")
                if key:
                    keys.append(key)
            if not response.get("IsTruncated"):
                break
            token = response.get("NextContinuationToken")
            if not token:
                break
    except ClientError as exc:
        if _is_access_denied(exc):
            print(
                "[WARN] s3:ListBucket denegado; se borran las keys conocidas "
                "(videoKey y evaluation.json).",
                flush=True,
            )
            return None
        raise RuntimeError(f"Error de S3 al listar objetos: {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Error de S3 al listar objetos: {exc}") from exc
    return keys


def delete_object_keys(keys):
    """Borra keys recordings/* en lotes de 1000. Requiere s3:DeleteObject."""
    unique = []
    seen = set()
    for key in keys:
        raw = str(key or "")
        if not raw.startswith("recordings/") or raw in seen:
            continue
        seen.add(raw)
        unique.append(raw)
    if not unique:
        return []

    settings = _require_settings()
    client = _client(settings["region"])
    deleted = []
    for index in range(0, len(unique), 1000):
        batch = unique[index : index + 1000]
        try:
            response = client.delete_objects(
                Bucket=settings["bucket"],
                Delete={"Objects": [{"Key": key} for key in batch], "Quiet": False},
            )
        except ClientError as exc:
            if _is_access_denied(exc):
                raise RuntimeError(
                    "IAM no permite s3:DeleteObject. Agrégalo sobre recordings/* y vuelve a intentar."
                ) from exc
            raise RuntimeError(f"Error de S3 al borrar objetos: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Error de S3 al borrar objetos: {exc}") from exc

        errors = response.get("Errors") or []
        if errors:
            first = errors[0]
            code = str(first.get("Code") or "")
            key = first.get("Key") or ""
            message = first.get("Message") or code
            if code in {"AccessDenied", "403"} or "access" in str(message).lower():
                raise RuntimeError(
                    "IAM no permite s3:DeleteObject. Agrégalo sobre recordings/* y vuelve a intentar."
                )
            raise RuntimeError(f"Error de S3 al borrar {key}: {message}")
        deleted.extend(
            item.get("Key") for item in (response.get("Deleted") or []) if item.get("Key")
        )
    return deleted


def delete_session_objects(session_id, extra_keys=None):
    """Elimina lo de una sesión en S3. Si hay ListBucket, borra el prefijo completo;
    si no, borra videoKey + evaluation.json (DeleteObject no exige listar)."""
    session = safe_session_id(session_id)
    prefix = f"recordings/{session}/"
    listed = list_objects_under_prefix(prefix)
    keys = set(listed or [])
    keys.add(f"{prefix}evaluation.json")
    for key in extra_keys or []:
        raw = str(key or "")
        parts = raw.split("/")
        if raw.startswith(prefix) or (len(parts) >= 2 and parts[0] == "recordings" and parts[1] == session):
            keys.add(raw)
    deleted = delete_object_keys(sorted(keys))
    return {"prefix": prefix, "deletedKeys": deleted, "listed": listed is not None}


def delete_video_object(key):
    if not str(key).startswith("recordings/"):
        raise RuntimeError("Clave de video no válida.")
    settings = _require_settings()
    client = _client(settings["region"])
    try:
        client.delete_object(Bucket=settings["bucket"], Key=key)
    except ClientError as exc:
        if _is_access_denied(exc):
            raise RuntimeError(
                "IAM no permite s3:DeleteObject. Agrégalo sobre recordings/* y vuelve a intentar."
            ) from exc
        raise RuntimeError(f"Error de S3: {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Error de S3: {exc}") from exc


def upload_evaluation_json(session_id, evaluation_data):
    """Guarda la rúbrica y el reporte cuantitativo en recordings/{session}/evaluation.json."""
    settings = _require_settings()
    session = safe_session_id(session_id)
    key = f"recordings/{session}/evaluation.json"
    client = _client(settings["region"])
    body = json.dumps(evaluation_data, ensure_ascii=False, indent=2).encode("utf-8")
    try:
        client.put_object(
            Bucket=settings["bucket"],
            Key=key,
            Body=body,
            ContentType="application/json; charset=utf-8",
        )
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Error de S3 al guardar evaluación: {exc}") from exc

    return {"key": key, "savedInS3": True}


def read_evaluation_json(session_id):
    """Lee la evaluación desde S3. Devuelve None si esa sesión aún no tiene una."""
    settings = _require_settings()
    session = safe_session_id(session_id)
    key = f"recordings/{session}/evaluation.json"
    client = _client(settings["region"])
    try:
        obj = client.get_object(Bucket=settings["bucket"], Key=key)
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        # Missing objects often come back as AccessDenied if the IAM user
        # cannot ListBucket. That is not a failed rubric load.
        if code in ("NoSuchKey", "404", "AccessDenied", "403"):
            return None
        raise RuntimeError(f"Error de S3 al leer evaluación: {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Error de S3 al leer evaluación: {exc}") from exc

    raw = obj["Body"].read().decode("utf-8")
    return json.loads(raw)
