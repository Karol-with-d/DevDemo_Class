const API_BASE = "http://127.0.0.1:8000";

export type SavedRecording = {
  sessionId: string;
  candidateName: string;
  evaluatorName: string;
  technology: string;
  complexity: string;
  savedAt: string;
  videoKey: string | null;
  savedInSystem: boolean;
  segmentCount: number;
};

export function playbackUrlForKey(key: string, download = false) {
  const params = new URLSearchParams({ key });
  if (download) params.set("download", "true");
  return `${API_BASE}/video?${params.toString()}`;
}

export async function uploadRecording(
  blob: Blob,
  sessionId: string,
): Promise<{ playbackUrl: string; key: string | null }> {
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
    return { playbackUrl: playbackUrlForKey(payload.key), key: payload.key };
  }
  if (!payload.video_url) {
    throw new Error("El backend no devolvió video_url");
  }
  return { playbackUrl: payload.video_url, key: null };
}

export async function listRecordings(): Promise<SavedRecording[]> {
  const response = await fetch(`${API_BASE}/recordings`);
  if (!response.ok) {
    throw new Error("No se pudieron listar las grabaciones.");
  }
  const payload = (await response.json()) as { recordings?: SavedRecording[] };
  return payload.recordings ?? [];
}

export async function deleteRecording(sessionId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/recordings/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "No se pudo eliminar la grabación.");
  }
}
