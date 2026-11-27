const API_BASE = "http://127.0.0.1:8000";

async function errorMessage(response: Response, fallback: string) {
  const raw = await response.text();
  if (!raw) return fallback;
  try {
    const payload = JSON.parse(raw) as { detail?: unknown };
    if (typeof payload.detail === "string" && payload.detail) return payload.detail;
  } catch {
    return raw;
  }
  return raw;
}

export type TechnicalTerm = {
  term: string;
  lemma?: string;
  category?: string;
  section?: string;
};

export type TranscriptSegment = {
  start: number;
  end?: number;
  text: string;
};

export type VideoStorage = "s3" | "local";

export type VideoIncident = {
  type: string;
  label: string;
  startSec: number;
  endSec: number;
  durationSec: number;
};

export type VideoMetrics = {
  framesAnalyzed: number;
  durationAnalyzedSec: number;
  personDetectedPct: number;
  orientation: {
    facingCameraPct: number;
    profilePct: number;
    backTurnedPct: number;
    headDownPct: number;
  };
  eyeContact: {
    directPct: number;
    gazeAwayPct: number;
    eyesClosedPct: number;
    lostDueToTurnPct: number;
  };
  expression: {
    cordialPct: number;
    neutralPct: number;
  };
  mobility: {
    activePct: number;
    level: string;
  };
  gestures: {
    visiblePct: number;
    activeWhenVisiblePct: number;
    handsMostlyOutOfFrame: boolean;
    level: string;
  };
  incidents: VideoIncident[];
};

export type MuletillasSummary = {
  total?: number;
  totalWords?: number;
  ratioPct?: number;
  breakdown?: Record<string, number>;
  items?: { phrase: string; count: number }[];
};

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
  segments?: TranscriptSegment[];
  vocabulary?: TechnicalTerm[];
  muletillas?: MuletillasSummary;
  videoMetrics?: VideoMetrics | null;
};

export type RubricSuggestion = {
  id: string;
  score: number | null;
  feedback: string;
  evidence: string | null;
};

type EvaluationContext = {
  source: "s3" | "local" | null;
  evaluation: {
    rubricScores?: {
      id: string;
      aiScore?: number | null;
      finalScore?: number | null;
      scale?: "E" | "MB" | "B" | "R" | "NM" | null;
      feedback?: string;
      evidence?: string | null;
    }[];
    overallVerdict?: string | null;
    qualitativeObservations?: string;
  } | null;
  segments: TranscriptSegment[];
  vocabulary: TechnicalTerm[];
  muletillas?: MuletillasSummary;
  videoMetrics?: VideoMetrics | null;
};

export async function getEvaluation(sessionId: string, signal?: AbortSignal): Promise<EvaluationContext> {
  const response = await fetch(`${API_BASE}/evaluations/${encodeURIComponent(sessionId)}`, { signal });
  if (!response.ok) throw new Error(await errorMessage(response, "No se pudo cargar la evaluación."));
  return response.json();
}

export async function getRubricSuggestions(
  sessionId: string,
  signal?: AbortSignal,
): Promise<{ dimensions: RubricSuggestion[] }> {
  const response = await fetch(`${API_BASE}/evaluations/${encodeURIComponent(sessionId)}/suggestions`, {
    method: "POST",
    signal,
  });
  if (!response.ok) throw new Error(await errorMessage(response, "No se pudieron generar sugerencias."));
  return response.json();
}

export async function saveEvaluation(
  sessionId: string,
  payload: object,
): Promise<{ key: string | null; source: "s3" | "local" }> {
  const response = await fetch(`${API_BASE}/evaluations/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await errorMessage(response, "No se pudo guardar la evaluación."));
  return response.json();
}

export function playbackUrlForKey(key: string, download = false) {
  const params = new URLSearchParams({ key });
  if (download) params.set("download", "true");
  return `${API_BASE}/video?${params.toString()}`;
}

export async function uploadRecording(
  blob: Blob,
  session: Pick<SavedRecording, "sessionId" | "candidateName" | "evaluatorName" | "technology" | "complexity">,
  options?: { audioBlob?: Blob | null; durationSeconds?: number },
): Promise<{ playbackUrl: string; key: string | null; source?: VideoStorage; transcriptStatus?: string }> {
  const extension = blob.type.includes("mp4") ? "mp4" : "webm";
  const body = new FormData();
  body.append("sessionId", session.sessionId);
  body.append("candidateName", session.candidateName);
  body.append("evaluatorName", session.evaluatorName);
  body.append("technology", session.technology);
  body.append("complexity", session.complexity);
  if (options?.durationSeconds && Number.isFinite(options.durationSeconds) && options.durationSeconds > 0) {
    body.append("durationSeconds", options.durationSeconds.toFixed(3));
  }
  body.append("file", blob, `recording.${extension}`);
  if (options?.audioBlob && options.audioBlob.size > 0) {
    const audioExt = options.audioBlob.type.includes("mp4")
      ? "mp4"
      : options.audioBlob.type.includes("ogg")
      ? "ogg"
      : "webm";
    body.append("audio", options.audioBlob, `audio.${audioExt}`);
  }

  const response = await fetch(`${API_BASE}/upload-video`, {
    method: "POST",
    body,
  });

  if (!response.ok) {
    throw new Error(await errorMessage(response, `No se pudo subir el video (${response.status})`));
  }

  const payload = (await response.json()) as {
    video_url?: string;
    key?: string;
    source?: VideoStorage;
    transcriptStatus?: string;
  };
  if (payload.key) {
    return {
      playbackUrl: playbackUrlForKey(payload.key),
      key: payload.key,
      source: payload.source,
      transcriptStatus: payload.transcriptStatus,
    };
  }
  if (!payload.video_url) {
    throw new Error("El backend no devolvió video_url");
  }
  return {
    playbackUrl: payload.video_url,
    key: null,
    source: payload.source,
    transcriptStatus: payload.transcriptStatus,
  };
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
    throw new Error(await errorMessage(response, "No se pudo eliminar la grabación."));
  }
}

export async function deleteCandidateFolder(candidateName: string): Promise<{
  candidateName: string;
  deletedSessionIds: string[];
  deletedS3Keys: string[];
}> {
  const response = await fetch(
    `${API_BASE}/candidates?name=${encodeURIComponent(candidateName)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    throw new Error(await errorMessage(response, "No se pudo eliminar la carpeta del candidato."));
  }
  return response.json();
}
