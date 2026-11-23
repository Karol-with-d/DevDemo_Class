"use client";

import React, { useEffect, useMemo, useState } from "react";
import { HybridRubricEditor, RubricIndicator } from "./HybridRubricEditor";
import { NLPVocabularyViewer } from "./NLPVocabularyViewer";

const API_BASE_URL = "http://127.0.0.1:8000";

export type UnivoScale = "E" | "MB" | "B" | "R" | "NM";
export type VerdictOption =
  | "Excelente / Destacado"
  | "Cumple adecuadamente"
  | "Debe mejorar"
  | "Requiere seguimiento";

interface DimensionItem {
  id: string;
  title: string;
  univoScope: string;
  aiScore: number;
  adjustedScore: number;
  scale: UnivoScale;
  feedback: string;
}

interface ConsolidatedReportViewProps {
  sessionId?: string;
  candidateName?: string;
  evaluatorName?: string;
  technology?: string;
  complexity?: string;
}

const SCALE_OPTIONS: { code: UnivoScale; label: string; score: number }[] = [
  { code: "E", label: "Excelente", score: 96 },
  { code: "MB", label: "Muy Bueno", score: 86 },
  { code: "B", label: "Bueno", score: 76 },
  { code: "R", label: "Regular", score: 65 },
  { code: "NM", label: "Necesita Mejorar", score: 50 },
];

const VERDICT_OPTIONS: VerdictOption[] = [
  "Excelente / Destacado",
  "Cumple adecuadamente",
  "Debe mejorar",
  "Requiere seguimiento",
];

const QUICK_TAGS = [
  "Buena activación de saberes previos",
  "Manejo claro del tiempo y cierre",
  "Buen dominio técnico y vocabulario PNL",
  "Fomentar mayor participación estudiantil",
  "Reforzar retroalimentación de errores",
];

const INITIAL_DIMENSIONS: DimensionItem[] = [
  {
    id: "innovacion_actualizacion",
    title: "Innovación y Actualización",
    univoScope: "Ítems 1–6 · Puntualidad, competencia, pre-saberes, dicción, recursos y PNL",
    aiScore: 88,
    adjustedScore: 88,
    scale: "MB",
    feedback: "Buen ritmo vocal, uso de recursos tecnológicos y terminología técnica pertinente.",
  },
  {
    id: "calidad_ensenanza",
    title: "Calidad de la Enseñanza",
    univoScope: "Ítems 7–14 · Plan de clase, distribución del tiempo, dominio y estrategias",
    aiScore: 85,
    adjustedScore: 85,
    scale: "MB",
    feedback: "Estructura ordenada y explicación clara de conceptos clave.",
  },
  {
    id: "relacion_estudiantes",
    title: "Relación con los Estudiantes",
    univoScope: "Ítems 15–20 · Respeto, conducción, ejemplos vivenciales, interés y consultas",
    aiScore: 80,
    adjustedScore: 80,
    scale: "MB",
    feedback: "Trato cordial y atención a consultas; se puede ampliar participación.",
  },
  {
    id: "evaluacion_retroalimentacion",
    title: "Evaluación y Retroalimentación",
    univoScope: "Ítems 21–26 · Seguimiento, comprensión, retroalimentación y cierre",
    aiScore: 78,
    adjustedScore: 78,
    scale: "B",
    feedback: "Comprueba comprensión durante la sesión; reforzar síntesis final.",
  },
];

function scoreToScale(score: number): UnivoScale {
  if (score >= 92) return "E";
  if (score >= 82) return "MB";
  if (score >= 72) return "B";
  if (score >= 60) return "R";
  return "NM";
}

export const ConsolidatedReportView: React.FC<ConsolidatedReportViewProps> = ({
  sessionId = "SES-DEMO-01",
  candidateName = "Candidato",
  evaluatorName = "",
  technology = "",
  complexity = "",
}) => {
  const [dimensions, setDimensions] = useState<DimensionItem[]>(INITIAL_DIMENSIONS);
  const [verdict, setVerdict] = useState<VerdictOption>("Cumple adecuadamente");
  const [qualitativeNotes, setQualitativeNotes] = useState("");
  const [savedPayload, setSavedPayload] = useState<string | null>(null);
  const [s3Key, setS3Key] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showAdvancedViews, setShowAdvancedViews] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  const sampleTranscript =
    "Durante la sesión implementamos un enfoque basado en componentes utilizando TypeScript, aplicando arquitecturas MVC y controlando el flujo de estados mediante hooks de React en el entorno de desarrollo.";
  const sampleTerms = ["TypeScript", "MVC", "hooks", "React", "componentes"];

  useEffect(() => {
    let cancelled = false;

    const loadExistingEvaluation = async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/evaluations/${encodeURIComponent(sessionId)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data?.evaluation) return;

        const saved = data.evaluation;
        if (Array.isArray(saved.rubricScores) && saved.rubricScores.length > 0) {
          setDimensions((prev) =>
            prev.map((item) => {
              const match = saved.rubricScores.find(
                (r: {
                  id?: string;
                  aiScore?: number;
                  finalScore?: number;
                  scale?: UnivoScale;
                }) => r.id === item.id
              );
              if (!match) return item;
              const nextScore =
                typeof match.finalScore === "number" ? match.finalScore : item.adjustedScore;
              return {
                ...item,
                aiScore: typeof match.aiScore === "number" ? match.aiScore : item.aiScore,
                adjustedScore: nextScore,
                scale: match.scale || scoreToScale(nextScore),
              };
            })
          );
        }

        if (saved.overallVerdict && VERDICT_OPTIONS.includes(saved.overallVerdict)) {
          setVerdict(saved.overallVerdict);
        }
        if (typeof saved.qualitativeObservations === "string") {
          setQualitativeNotes(saved.qualitativeObservations);
        }

        setSavedPayload(JSON.stringify(saved, null, 2));
        setStatusMessage({
          type: "info",
          text: `Evaluación cargada desde ${data.source === "s3" ? "AWS S3" : "registro local"}.`,
        });
      } catch {
        // No bloquear si el backend aún no arranca
      }
    };

    loadExistingEvaluation();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const metrics = useMemo(() => {
    const avgScore = Math.round(
      dimensions.reduce((acc, d) => acc + d.adjustedScore, 0) / dimensions.length
    );
    const counts: Record<UnivoScale, number> = { E: 0, MB: 0, B: 0, R: 0, NM: 0 };
    for (const d of dimensions) {
      counts[d.scale] += 1;
    }
    return { avgScore, counts };
  }, [dimensions]);

  const legacyIndicators: RubricIndicator[] = useMemo(
    () =>
      dimensions.map((d) => ({
        id: d.id,
        label: d.title,
        aiScore: d.aiScore,
        adjustedScore: d.adjustedScore,
        feedback: d.feedback,
      })),
    [dimensions]
  );

  const handleScaleSelect = (id: string, scale: UnivoScale) => {
    const preset = SCALE_OPTIONS.find((s) => s.code === scale);
    setDimensions((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              scale,
              adjustedScore: preset ? preset.score : item.adjustedScore,
            }
          : item
      )
    );
  };

  const handleScoreChange = (id: string, newScore: number) => {
    const clamped = Math.max(0, Math.min(100, Number(newScore) || 0));
    setDimensions((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, adjustedScore: clamped, scale: scoreToScale(clamped) }
          : item
      )
    );
  };

  const handleToggleTag = (tag: string) => {
    setQualitativeNotes((prev) => {
      const current = prev.trim();
      if (!current) return tag;
      if (current.includes(tag)) {
        return current
          .split(" · ")
          .filter((part) => part !== tag)
          .join(" · ");
      }
      return `${current} · ${tag}`;
    });
  };

  const handleSaveEvaluation = async () => {
    setIsSaving(true);
    setStatusMessage(null);

    const jsonPayload = {
      sessionId,
      candidateName,
      evaluatorName,
      technology,
      complexity,
      rubricStandard: "UNIVO-Observacion-Docente",
      overallVerdict: verdict,
      quantitativeSummary: {
        averageScore: metrics.avgScore,
        scaleDistribution: metrics.counts,
        nlpTermsCount: sampleTerms.length,
      },
      timestamp: new Date().toISOString(),
      rubricScores: dimensions.map(({ id, title, univoScope, aiScore, adjustedScore, scale }) => ({
        id,
        label: title,
        univoScope,
        scale,
        aiScore,
        finalScore: adjustedScore,
        manuallyAdjusted: aiScore !== adjustedScore,
      })),
      nlpDetectedTerms: sampleTerms,
      qualitativeObservations: qualitativeNotes,
    };

    try {
      const response = await fetch(
        `${API_BASE_URL}/evaluations/${encodeURIComponent(sessionId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(jsonPayload),
        }
      );

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.detail || `Error HTTP ${response.status}`);
      }

      setSavedPayload(JSON.stringify(jsonPayload, null, 2));
      setS3Key(result.key || `recordings/${sessionId}/evaluation.json`);
      setStatusMessage({
        type: "success",
        text: `Guardado en AWS S3 (${result.key || "evaluation.json"})`,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "No se pudo guardar la evaluación.";
      setStatusMessage({
        type: "error",
        text: `Error al guardar: ${message}`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Encabezado + KPIs rápidos */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Consolidado de Evaluación</h2>
          <p className="text-xs text-slate-400">
            Guía de Observación UNIVO · Escala E / MB / B / R / NM + Reporte Cuantitativo y PNL
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono px-3 py-1 rounded-full bg-slate-900 text-emerald-400 border border-emerald-500/30">
            Promedio: {metrics.avgScore}%
          </span>
          <span className="text-xs font-mono px-3 py-1 rounded-full bg-slate-900 text-slate-300 border border-slate-700">
            {sessionId}
          </span>
        </div>
      </div>

      {/* Barra de resumen cuantitativo + vista detalle */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400 mr-1">Distribución:</span>
          {SCALE_OPTIONS.map((opt) => (
            <span
              key={opt.code}
              className="px-2.5 py-1 rounded-md bg-slate-950 border border-slate-800 text-slate-200 font-mono"
              title={opt.label}
            >
              {opt.code}: <strong>{metrics.counts[opt.code]}</strong>
            </span>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setShowAdvancedViews((v) => !v)}
          className="text-xs px-3 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-700 transition-colors cursor-pointer"
        >
          {showAdvancedViews ? "Ocultar detalle PNL/Slider" : "Ver detalle PNL/Slider"}
        </button>
      </div>

      {/* Rúbrica ágil por dimensiones UNIVO */}
      <div className="space-y-3">
        {dimensions.map((item) => (
          <div
            key={item.id}
            className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
          >
            <div className="space-y-1 max-w-xl">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-white text-sm">{item.title}</h3>
                <span className="text-[11px] font-mono text-slate-400">
                  IA: {item.aiScore} → {item.adjustedScore}
                </span>
              </div>
              <p className="text-[11px] text-emerald-400/90">{item.univoScope}</p>
              <p className="text-xs text-slate-400">{item.feedback}</p>
            </div>

            <div className="flex flex-col items-start md:items-end gap-2">
              <div className="flex items-center gap-1.5">
                {SCALE_OPTIONS.map((opt) => {
                  const active = item.scale === opt.code;
                  return (
                    <button
                      key={opt.code}
                      type="button"
                      onClick={() => handleScaleSelect(item.id, opt.code)}
                      title={`${opt.code} — ${opt.label}`}
                      className={`w-10 h-9 rounded-lg text-xs font-bold transition-colors cursor-pointer border ${
                        active
                          ? "bg-emerald-600 text-white border-emerald-400"
                          : "bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-600"
                      }`}
                    >
                      {opt.code}
                    </button>
                  );
                })}
              </div>

              <label className="flex items-center gap-2 text-[11px] text-slate-400">
                <span>Puntaje:</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={item.adjustedScore}
                  onChange={(e) => handleScoreChange(item.id, Number(e.target.value))}
                  className="w-16 bg-slate-950 border border-slate-800 rounded px-2 py-0.5 text-right text-slate-100 font-mono text-xs"
                />
              </label>
            </div>
          </div>
        ))}
      </div>

      {/* Vista expandible opcional con componentes previos */}
      {showAdvancedViews && (
        <div className="space-y-4 pt-2">
          <HybridRubricEditor
            indicators={legacyIndicators}
            onScoreChange={handleScoreChange}
          />
          <NLPVocabularyViewer
            transcript={sampleTranscript}
            technicalTerms={sampleTerms}
          />
        </div>
      )}

      {/* Dictamen rápido + Chips + Observaciones y Guardado en S3 */}
      <div className="bg-slate-900 text-white p-6 rounded-xl border border-emerald-500/30 shadow-lg space-y-4">
        <div>
          <h3 className="text-base font-semibold text-emerald-400">
            Dictamen y Observaciones del Evaluador
          </h3>
          <p className="text-xs text-slate-400">
            Selecciona el dictamen general, haz clic en etiquetas rápidas o escribe observaciones adicionales.
          </p>
        </div>

        {/* Selector rápido de dictamen */}
        <div className="flex flex-wrap gap-2">
          {VERDICT_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setVerdict(option)}
              className={`text-xs px-3.5 py-1.5 rounded-full border transition-colors cursor-pointer ${
                verdict === option
                  ? "bg-emerald-600/20 border-emerald-400 text-emerald-300 font-semibold"
                  : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        {/* Etiquetas rápidas de un clic */}
        <div className="flex flex-wrap gap-1.5">
          {QUICK_TAGS.map((tag) => {
            const selected = qualitativeNotes.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => handleToggleTag(tag)}
                className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors cursor-pointer ${
                  selected
                    ? "bg-sky-500/20 border-sky-400 text-sky-300"
                    : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                }`}
              >
                {selected ? "✓ " : "+ "}
                {tag}
              </button>
            );
          })}
        </div>

        <textarea
          value={qualitativeNotes}
          onChange={(e) => setQualitativeNotes(e.target.value)}
          placeholder="Otras observaciones / sugerencias o elementos destacados (opcional si ya usaste etiquetas)..."
          className="w-full h-24 bg-slate-950 text-slate-100 p-3.5 rounded-lg border border-slate-800 focus:outline-none focus:border-emerald-500 text-sm resize-none"
        />

        <div className="flex flex-wrap items-center justify-between gap-4">
          <button
            type="button"
            onClick={handleSaveEvaluation}
            disabled={isSaving}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors cursor-pointer"
          >
            {isSaving ? "Guardando en S3..." : "Guardar Evaluación Consolidada"}
          </button>

          {statusMessage && (
            <span
              className={`text-xs font-semibold ${
                statusMessage.type === "error"
                  ? "text-rose-400"
                  : statusMessage.type === "info"
                  ? "text-sky-400"
                  : "text-emerald-400"
              }`}
            >
              {statusMessage.type === "success" ? "✓ " : ""}
              {statusMessage.text}
            </span>
          )}
        </div>

        {savedPayload && (
          <div className="mt-4 bg-slate-950 p-4 rounded-lg border border-slate-800">
            <p className="text-xs text-slate-400 mb-2 font-mono">
              JSON persistido {s3Key ? `en S3 (${s3Key})` : ""}:
            </p>
            <pre className="text-xs text-emerald-300 overflow-x-auto">{savedPayload}</pre>
          </div>
        )}
      </div>
    </div>
  );
};