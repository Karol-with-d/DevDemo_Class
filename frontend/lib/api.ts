const API_BASE = "http://127.0.0.1:8000";

export function playbackUrlForKey(key: string) {
  return `${API_BASE}/video?key=${encodeURIComponent(key)}`;
}

export async function uploadRecording(blob: Blob, sessionId: string): Promise<string> {
  const extension = blob.type.includes("mp4") ? "mp4" : "webm";
  const body = new FormData();
  body.append("sessionId", sessionId);
  body.append("file", blob, `recording.${extension}`);

  const response = await fetch(`${API_BASE}/upload-video`, {
    method: "POST",
    body,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `No se pudo subir el video (${response.status})`);
  }

  const payload = (await response.json()) as { video_url?: string; key?: string };
  if (payload.key) {
    return playbackUrlForKey(payload.key);
  }
  if (!payload.video_url) {
    throw new Error("El backend no devolvió video_url");
  }
  return payload.video_url;
}
