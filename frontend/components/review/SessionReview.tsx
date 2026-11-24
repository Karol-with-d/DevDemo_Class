"use client";

// ============================================================================
// US11 — Navegación fluida entre vistas (Épica 5: Galería y Gestión de Grabaciones)
//
// Contenedor de la "Auditoría de Sesión": barra superior con 3 pestañas
// (Reporte / Rúbrica / Grabaciones) que conmutan INSTANTÁNEAMENTE vía useState,
// sin recargar la página ni usar el router de Next.js.
//
// Dos modos de entrada:
//  - Post-grabación (props session + transcript): muestra los datos reales de
//    la sesión recién terminada; la pestaña Grabaciones lista todo el sistema.
//  - Historial (prop recordings): se entra desde una tarjeta de
//    EvaluationsOverview; reporte, rúbrica y grabaciones se alimentan del
//    SavedRecording seleccionado de ese candidato.
// ============================================================================

import { useState } from "react";
import { SessionData } from "../session/SessionForm";
import { TranscriptSaveResult } from "../recording/useLiveTranscript";
import { SavedRecording, deleteRecording, playbackUrlForKey } from "../../lib/api";
import { ReportView } from "./ReportView";
import { RubricView } from "./RubricView";
import { GalleryView } from "./GalleryView";

// Identificadores internos de cada pestaña.
type ReviewTab = "report" | "rubric" | "gallery";

interface SessionReviewProps {
  session: SessionData | null;                // Datos del Paso 1 (SessionSetup)
  transcript: TranscriptSaveResult | null;    // Resultado guardado por Whisper al cerrar la sesión
  recordings?: SavedRecording[];              // Sesiones del candidato (modo historial)
  onBack?: () => void;                        // Volver a la vista de evaluaciones
  onNewSession: () => void;                   // Callback para volver al inicio del flujo
}

function recordingToSession(rec: SavedRecording): SessionData {
  return {
    sessionId: rec.sessionId,
    candidateName: rec.candidateName,
    evaluatorName: rec.evaluatorName,
    technology: rec.technology,
    complexity: rec.complexity,
  };
}

function recordingToTranscript(rec: SavedRecording): TranscriptSaveResult {
  return {
    segments: (rec.segments ?? []).map((seg) => ({ ...seg, end: seg.end ?? seg.start })),
    vocabulary: rec.vocabulary ?? [],
    videoKey: rec.videoKey,
    videoUrl: rec.videoKey ? playbackUrlForKey(rec.videoKey) : null,
    jsonPath: null,
    vttPath: null,
    txtPath: null,
    docxPath: null,
  };
}

function formatChipDate(iso: string): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("es", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SessionReview({ session, transcript, recordings, onBack, onNewSession }: SessionReviewProps) {
  // Pestaña activa: cambiar este estado re-renderiza solo la vista inferior.
  const [activeTab, setActiveTab] = useState<ReviewTab>("report");

  // Modo historial: el candidato puede tener varias sesiones guardadas.
  const [items, setItems] = useState<SavedRecording[]>(recordings ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(
    recordings?.[0]?.sessionId ?? null,
  );
  const isHistoryMode = recordings !== undefined;
  const selected = items.find((r) => r.sessionId === selectedId) ?? items[0] ?? null;

  const effectiveSession = isHistoryMode ? (selected ? recordingToSession(selected) : null) : session;
  const effectiveTranscript = isHistoryMode
    ? (selected ? recordingToTranscript(selected) : null)
    : transcript;

  const handleDelete = async (sessionId: string) => {
    await deleteRecording(sessionId);
    setItems((current) => {
      const next = current.filter((r) => r.sessionId !== sessionId);
      if (selectedId === sessionId) {
        setSelectedId(next[0]?.sessionId ?? null);
      }
      if (next.length === 0) {
        setTimeout(() => onBack?.(), 0);
      }
      return next;
    });
  };

  const tabs: { id: ReviewTab; label: string }[] = [
    { id: "report", label: "Ver Reporte" },
    { id: "rubric", label: "Ver Rúbrica" },
    { id: "gallery", label: isHistoryMode ? "Grabaciones" : "Galería de Videos" },
  ];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      {/* Barra superior: contexto de la sesión + navegación por pestañas.
          El contexto (candidato, ID, tecnología) permanece fijo sin importar
          la pestaña activa — requisito del criterio de aceptación de US11. */}
      <div className="overflow-hidden rounded-2xl border border-[rgba(194,220,213,0.12)] bg-[#11191e] shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 pb-3 pt-5">
          <div>
            <span className="eyebrow">Auditoría de Sesión</span>
            <h2 className="font-manrope text-xl font-bold text-white">
              Evaluación: {effectiveSession?.candidateName || "Candidato"}
            </h2>
            <div className="session-label">
              <span className="session-dot" />
              <span>
                {effectiveSession?.sessionId || "SES-000000"} · {effectiveSession?.technology} ·{" "}
                {effectiveSession?.complexity} · Evaluador: {effectiveSession?.evaluatorName || "—"}
              </span>
            </div>
            {/* Aviso temporal: quitar cuando se integre la rúbrica real de US10 */}
            <p className="mt-2 text-[10px] text-[#5b6b68]">
              * La rúbrica muestra criterios de muestra, pendiente de integración con US10.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {onBack && (
              <button
                onClick={onBack}
                className="cursor-pointer rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs font-bold text-[#e9f0ed] transition-all hover:border-white/30"
              >
                ← Evaluaciones
              </button>
            )}
            <button
              onClick={onNewSession}
              className="cursor-pointer rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs font-bold text-[#e9f0ed] transition-all hover:border-[#9ce4c1]/40 hover:text-[#9ce4c1]"
            >
              Iniciar nueva sesión
            </button>
          </div>
        </div>

        {/* Selector de sesión: visible solo cuando el candidato tiene varias
            evaluaciones guardadas. Cambia reporte, rúbrica y grabación a la vez. */}
        {isHistoryMode && items.length > 1 && (
          <div className="flex flex-wrap gap-2 border-t border-[rgba(194,220,213,0.08)] px-5 py-3">
            {items.map((rec) => {
              const isSelected = rec.sessionId === selected?.sessionId;
              const date = formatChipDate(rec.savedAt);
              return (
                <button
                  key={rec.sessionId}
                  type="button"
                  onClick={() => setSelectedId(rec.sessionId)}
                  className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    isSelected
                      ? "border-[#9ce4c1]/60 bg-[#9ce4c1]/10 text-[#9ce4c1]"
                      : "border-white/10 bg-white/[0.03] text-[#82918f] hover:border-white/25 hover:text-[#e9f0ed]"
                  }`}
                >
                  {rec.sessionId}
                  {date ? ` · ${date}` : ""}
                </button>
              );
            })}
          </div>
        )}

        {/* Menú de navegación. Cada botón actualiza `activeTab` — el cambio de
            vista es inmediato porque todo vive en el cliente (sin fetch ni reload). */}
        <nav
          role="tablist"
          aria-label="Vistas de auditoría"
          className="flex gap-1 border-t border-[rgba(194,220,213,0.08)] px-3"
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={`relative cursor-pointer px-4 py-3 text-sm font-semibold transition-colors duration-150 ${
                  isActive ? "text-[#9ce4c1]" : "text-[#82918f] hover:text-[#e9f0ed]"
                }`}
              >
                {tab.label}
                {/* Indicador inferior de la pestaña activa */}
                <span
                  className={`absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-[#9ce4c1] transition-opacity duration-150 ${
                    isActive ? "opacity-100 shadow-[0_0_8px_#9ce4c1]" : "opacity-0"
                  }`}
                />
              </button>
            );
          })}
        </nav>
      </div>

      {/* Vista activa. `key` fuerza el re-montaje para re-disparar la animación
          .tab-panel (definida en globals.css) en cada cambio de pestaña o sesión. */}
      <div key={`${activeTab}-${selected?.sessionId ?? "current"}`} className="tab-panel">
        {activeTab === "report" && <ReportView session={effectiveSession} transcript={effectiveTranscript} />}
        {activeTab === "rubric" && <RubricView session={effectiveSession} />}
        {activeTab === "gallery" &&
          (isHistoryMode ? (
            <GalleryView
              items={items}
              selectedId={selected?.sessionId ?? null}
              onSelect={(rec) => setSelectedId(rec.sessionId)}
              onDelete={handleDelete}
            />
          ) : (
            <GalleryView />
          ))}
      </div>
    </div>
  );
}
