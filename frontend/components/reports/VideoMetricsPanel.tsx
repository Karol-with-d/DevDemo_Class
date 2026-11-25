"use client";

import type { MuletillasSummary, VideoMetrics } from "../../lib/api";

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function barColor(pct: number): string {
  if (pct >= 80) return "bg-emerald-400";
  if (pct >= 55) return "bg-amber-400";
  return "bg-rose-400";
}

interface VideoMetricsPanelProps {
  videoMetrics?: VideoMetrics | null;
  muletillas?: MuletillasSummary | null;
}

export function VideoMetricsPanel({ videoMetrics, muletillas }: VideoMetricsPanelProps) {
  const hasMuletillas = Boolean(muletillas && (muletillas.totalWords ?? 0) > 0);
  if (!videoMetrics && !hasMuletillas) return null;

  const incidents = videoMetrics?.incidents ?? [];
  const muletillaItems = muletillas?.items ?? [];

  return (
    <section className="rounded-2xl border border-[rgba(194,220,213,0.12)] bg-[#11191e] p-5 shadow-xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="eyebrow">Análisis de Video y Expresión Oral</span>
          <h3 className="font-manrope text-base font-bold text-white">
            Presencia Docente y Fluidez
          </h3>
        </div>
        {videoMetrics && (
          <span className="rounded-full border border-white/10 bg-[#0d1519] px-3 py-1 text-[11px] font-mono text-[#82918f]">
            {videoMetrics.framesAnalyzed} muestras · {formatClock(videoMetrics.durationAnalyzedSec)} analizados
          </span>
        )}
      </div>

      {videoMetrics && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-[#0d1519] p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs text-[#82918f]">
              <span>Frente a la cámara</span>
              <span className="font-mono font-bold text-white">
                {videoMetrics.orientation.facingCameraPct}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full ${barColor(videoMetrics.orientation.facingCameraPct)}`}
                style={{ width: `${videoMetrics.orientation.facingCameraPct}%` }}
              />
            </div>
            <p className="text-[11px] text-[#82918f]">
              Perfil {videoMetrics.orientation.profilePct}% · Espaldas {videoMetrics.orientation.backTurnedPct}%
              {videoMetrics.orientation.headDownPct > 0
                ? ` · Cabeza baja ${videoMetrics.orientation.headDownPct}%`
                : ""}
            </p>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#0d1519] p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs text-[#82918f]">
              <span>Contacto visual directo</span>
              <span className="font-mono font-bold text-white">
                {videoMetrics.eyeContact.directPct}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full ${barColor(videoMetrics.eyeContact.directPct)}`}
                style={{ width: `${videoMetrics.eyeContact.directPct}%` }}
              />
            </div>
            <p className="text-[11px] text-[#82918f]">
              Expresión cordial {videoMetrics.expression.cordialPct}% · Desviada{" "}
              {videoMetrics.eyeContact.gazeAwayPct}%
            </p>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#0d1519] p-3.5 space-y-1.5">
            <span className="text-xs text-[#82918f]">Dinamismo corporal</span>
            <p className="text-sm font-bold text-white">{videoMetrics.mobility.level}</p>
            <p className="text-[11px] font-mono text-[#9ce4c1]">
              Actividad: {videoMetrics.mobility.activePct}% del tiempo
            </p>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#0d1519] p-3.5 space-y-1.5">
            <span className="text-xs text-[#82918f]">Gesticulación</span>
            <p className="text-sm font-bold text-white">{videoMetrics.gestures.level}</p>
            <p className="text-[11px] text-[#82918f]">
              {videoMetrics.gestures.handsMostlyOutOfFrame
                ? "Manos fuera del encuadre (no penaliza)"
                : `Manos visibles ${videoMetrics.gestures.visiblePct}% · Activas ${videoMetrics.gestures.activeWhenVisiblePct}%`}
            </p>
          </div>
        </div>
      )}

      {incidents.length > 0 && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-950/20 p-3.5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-300">
            Momentos de atención detectados en video
          </p>
          <ul className="flex flex-wrap gap-2">
            {incidents.map((inc, idx) => (
              <li
                key={`${inc.type}-${inc.startSec}-${idx}`}
                className="rounded-lg border border-amber-500/30 bg-black/30 px-2.5 py-1 text-xs text-amber-100"
              >
                <span className="mr-1.5 font-mono text-amber-300">
                  {formatClock(inc.startSec)}–{formatClock(inc.endSec)}
                </span>
                {inc.label} ({inc.durationSec}s)
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasMuletillas && muletillas && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#0d1519] px-3.5 py-2.5 text-xs">
          <span className="text-[#82918f]">
            Muletillas detectadas:{" "}
            <strong className="font-mono text-white">
              {muletillas.total ?? 0}
            </strong>{" "}
            <span className="font-mono text-[#9ce4c1]">
              ({muletillas.ratioPct ?? 0}% de {muletillas.totalWords ?? 0} palabras)
            </span>
          </span>
          {muletillaItems.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {muletillaItems.slice(0, 6).map((item) => (
                <span
                  key={item.phrase}
                  className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[11px] text-[#e9f0ed]"
                >
                  “{item.phrase}” ×{item.count}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
