"use client";

// ============================================================================
// US11 · Vista "Ver Reporte"
// Métricas consolidadas de la sesión + transcripción técnica con vocabulario
// resaltado.
//
// En esta rama los datos son REALES: provienen del TranscriptSaveResult que
// generó el backend (Whisper + spaCy + S3) al finalizar la grabación.
// ============================================================================

import { SessionData } from "../session/SessionForm";
import { TranscriptSaveResult } from "../recording/useLiveTranscript";
import { TechnicalTranscript } from "../recording/TechnicalTranscript";
import { VideoMetricsPanel } from "../reports/VideoMetricsPanel";

interface ReportViewProps {
  session: SessionData | null;
  transcript: TranscriptSaveResult | null;
}

// Convierte segundos a formato MM:SS.
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function ReportView({ session, transcript }: ReportViewProps) {
  const segments = transcript?.segments ?? [];
  const vocabulary = transcript?.vocabulary ?? [];

  // Duración real = fin del último subtítulo registrado por Whisper.
  const lastEnd = segments.reduce((max, seg) => Math.max(max, seg.end ?? 0), 0);

  const metrics = [
    { label: "Duración de la sesión", value: lastEnd > 0 ? formatDuration(lastEnd) : "—", suffix: "min" },
    { label: "Subtítulos registrados", value: `${segments.length}`, suffix: "" },
    { label: "Términos técnicos", value: `${vocabulary.length}`, suffix: "" },
    {
      label: "Video en el sistema",
      value: transcript?.videoKey ? "Guardado" : "Sin video",
      suffix: "",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Métricas principales (datos reales de la sesión) */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="rounded-2xl border border-[rgba(194,220,213,0.12)] bg-[#11191e] p-5 shadow-xl"
          >
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#82918f]">
              {m.label}
            </span>
            <p className="mt-2 font-manrope text-2xl font-extrabold text-white">
              {m.value}
              {m.suffix && (
                <span className="ml-1 text-sm font-semibold text-[#9ce4c1]">{m.suffix}</span>
              )}
            </p>
          </div>
        ))}
      </div>

      {/* Análisis de video y muletillas */}
      <VideoMetricsPanel
        videoMetrics={transcript?.videoMetrics}
        muletillas={transcript?.muletillas}
      />

      {/* Transcripción real con vocabulario resaltado (US08) */}
      <div className="rounded-2xl border border-[rgba(194,220,213,0.12)] bg-[#11191e] p-6 shadow-xl">
        <span className="eyebrow">Transcripción y vocabulario técnico</span>
        {segments.length > 0 || vocabulary.length > 0 ? (
          <TechnicalTranscript
            segments={segments}
            vocabulary={vocabulary}
            muletillas={transcript?.muletillas}
          />
        ) : (
          <p className="mt-3 text-sm text-[#82918f]">
            Esta sesión no tiene transcripción guardada. Completa una grabación
            para ver el reporte con subtítulos y términos técnicos resaltados.
          </p>
        )}
      </div>
    </div>
  );
}
