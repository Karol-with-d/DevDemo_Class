"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { HybridRubricEditor, RubricIndicator } from "./HybridRubricEditor";
import { getEvaluation, getRubricSuggestions, saveEvaluation, type RubricSuggestion, type TechnicalTerm, type TranscriptSegment } from "../../lib/api";
import rubric from "../../lib/univo-rubric.json";
import { TechnicalTranscript } from "../recording/TechnicalTranscript";
import { PerformanceMetricsChart } from "./PerformanceMetricsChart";

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
  aiScore: number | null;
  adjustedScore: number | null;
  scale: UnivoScale | null;
  feedback: string;
  evidence: string | null;
}

interface ConsolidatedReportViewProps {
  sessionId: string;
  autoSuggest?: boolean;
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

const INITIAL_DIMENSIONS: DimensionItem[] = rubric.map(({ id, title, univoScope }) => ({
  id,
  title,
  univoScope,
  aiScore: null,
  adjustedScore: null,
  scale: null,
  feedback: "",
  evidence: null,
}));

function applySuggestions(dimensions: DimensionItem[], suggestions: RubricSuggestion[]) {
  return dimensions.map((dimension) => {
    const suggestion = suggestions.find(({ id }) => id === dimension.id);
    if (!suggestion) return dimension;
    const adjustedScore = dimension.adjustedScore ?? suggestion.score;
    return {
      ...dimension,
      aiScore: suggestion.score,
      adjustedScore,
      scale: adjustedScore === null ? null : scoreToScale(adjustedScore),
      feedback: suggestion.feedback,
      evidence: suggestion.evidence,
    };
  });
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function formatScore(score: number | null) {
  return score === null ? "Sin evaluar" : `${score}%`;
}

function savedScore(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

function scoreToScale(score: number): UnivoScale {
  if (score >= 92) return "E";
  if (score >= 82) return "MB";
  if (score >= 72) return "B";
  if (score >= 60) return "R";
  return "NM";
}

export const ConsolidatedReportView: React.FC<ConsolidatedReportViewProps> = ({
  sessionId,
  autoSuggest = false,
  candidateName = "Candidato",
  evaluatorName = "",
  technology = "",
  complexity = "",
}) => {
  const [dimensions, setDimensions] = useState<DimensionItem[]>(INITIAL_DIMENSIONS);
  const [verdict, setVerdict] = useState<VerdictOption | null>(null);
  const [qualitativeNotes, setQualitativeNotes] = useState("");
  const [savedPayload, setSavedPayload] = useState<string | null>(null);
  const [savedLocation, setSavedLocation] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showAdvancedViews, setShowAdvancedViews] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [vocabulary, setVocabulary] = useState<TechnicalTerm[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);

  const requestSuggestions = useCallback(async (signal?: AbortSignal) => {
    setSuggesting(true);
    setSuggestionError(null);
    try {
      const { dimensions: suggestions } = await getRubricSuggestions(sessionId, signal);
      if (signal?.aborted) return;
      setDimensions((current) => applySuggestions(current, suggestions));
      setSuggestionsLoaded(suggestions.length > 0);
    } catch (error) {
      if (!signal?.aborted && error instanceof Error) {
        setSuggestionError(error.message);
      }
    } finally {
      if (!signal?.aborted) setSuggesting(false);
    }
  }, [sessionId]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    async function load() {
      let context;
      try {
        context = await getEvaluation(sessionId, signal);
      } catch {
        if (!signal.aborted) setLoadState("error");
        return;
      }
      if (signal.aborted) return;

      setSegments(context.segments);
      setVocabulary(context.vocabulary);
      const saved = context.evaluation;
      if (saved) {
        const scores = Array.isArray(saved.rubricScores) ? saved.rubricScores : [];
        setDimensions(INITIAL_DIMENSIONS.map((item) => {
          const score = scores.find((entry) => entry?.id === item.id);
          if (!score) return item;
          const adjustedScore = savedScore(score.finalScore);
          const savedScale = SCALE_OPTIONS.find(({ code }) => code === score.scale);
          return {
            ...item,
            aiScore: savedScore(score.aiScore),
            adjustedScore,
            scale: adjustedScore === null ? null : savedScale?.code ?? scoreToScale(adjustedScore),
            feedback: typeof score.feedback === "string" ? score.feedback : "",
            evidence: typeof score.evidence === "string" ? score.evidence : null,
          };
        }));
        if (saved.overallVerdict && VERDICT_OPTIONS.includes(saved.overallVerdict as VerdictOption)) {
          setVerdict(saved.overallVerdict as VerdictOption);
        }
        if (typeof saved.qualitativeObservations === "string") {
          setQualitativeNotes(saved.qualitativeObservations);
        }
        setSavedPayload(JSON.stringify(saved, null, 2));
        setSavedLocation(context.source === "s3" ? "en AWS S3" : "en este equipo");
        setSuggestionsLoaded(true);
      }

      setLoadState("ready");
      if (!saved && autoSuggest && context.segments.some(({ text }) => text.trim())) {
        await requestSuggestions(signal);
      }
    }

    void load();
    return () => controller.abort();
  }, [sessionId, autoSuggest, loadAttempt, requestSuggestions]);

  const metrics = useMemo(() => {
    const scores = dimensions.flatMap(({ adjustedScore }) => adjustedScore === null ? [] : [adjustedScore]);
    const avgScore = scores.length
      ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
      : null;
    const counts: Record<UnivoScale, number> = { E: 0, MB: 0, B: 0, R: 0, NM: 0 };
    for (const { scale } of dimensions) {
      if (scale) counts[scale] += 1;
    }
    return { avgScore, counts };
  }, [dimensions]);

  const legacyIndicators: RubricIndicator[] = dimensions.flatMap((item) =>
    item.adjustedScore === null ? [] : [{
      id: item.id,
      label: item.title,
      aiScore: item.aiScore,
      adjustedScore: item.adjustedScore,
      feedback: item.feedback,
    }],
  );

  const hasTranscript = segments.some(({ text }) => text.trim());
  const terms = vocabulary.map(({ term }) => term);

  const buildEvaluationPayload = () => ({
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
      nlpTermsCount: terms.length,
    },
    timestamp: new Date().toISOString(),
    rubricScores: dimensions.map(
      ({ id, title, univoScope, aiScore, adjustedScore, scale, feedback, evidence }) => ({
        id,
        label: title,
        univoScope,
        scale,
        aiScore,
        finalScore: adjustedScore,
        manuallyAdjusted: adjustedScore !== null && aiScore !== adjustedScore,
        feedback,
        evidence,
      })
    ),
    nlpDetectedTerms: terms,
    qualitativeObservations: qualitativeNotes,
  });

  const handleDownloadRubric = () => {
    const data = buildEvaluationPayload();
    const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const fileTitle = `Rubrica_${safeSessionId}_${new Date().toISOString().slice(0, 10)}`;

    const rowsHtml = data.rubricScores
      .map(
        (r) => `
          <tr>
            <td style="padding:10px;border:1px solid #cbd5e1;">
              <strong>${escapeHtml(r.label)}</strong><br/>
              <span style="font-size:11px;color:#475569;">${escapeHtml(r.univoScope)}</span><br/>
              <span style="font-size:12px;color:#334155;">${escapeHtml(r.feedback)}${r.evidence ? `<br/>«${escapeHtml(r.evidence)}»` : ""}</span>
            </td>
            <td style="padding:10px;border:1px solid #cbd5e1;text-align:center;">${r.aiScore === null ? "Sin sugerencia" : formatScore(r.aiScore)}</td>
            <td style="padding:10px;border:1px solid #cbd5e1;text-align:center;font-weight:bold;">${formatScore(r.finalScore)}</td>
            <td style="padding:10px;border:1px solid #cbd5e1;text-align:center;font-weight:bold;">${r.scale ?? "—"}</td>
          </tr>
        `
      )
      .join("");

    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) {
      setStatusMessage({
        type: "error",
        text: "Permite las ventanas emergentes en el navegador para exportar el PDF.",
      });
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8" />
        <title>${fileTitle}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #0f172a; padding: 28px; }
          h1 { margin: 0 0 6px; font-size: 20px; }
          .meta { font-size: 12px; color: #475569; margin-bottom: 18px; }
          .summary { display: flex; gap: 16px; margin-bottom: 18px; font-size: 13px; flex-wrap: wrap; }
          .box { border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px 14px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 18px; font-size: 13px; }
          th { background: #f1f5f9; padding: 10px; border: 1px solid #cbd5e1; text-align: left; }
          th.center { text-align: center; }
          .notes { border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px; background: #f8fafc; font-size: 13px; }
          @media print { .no-print { display: none; } }
        </style>
      </head>
      <body>
        <div class="no-print" style="margin-bottom:14px;">
          <button onclick="window.print()" style="padding:8px 14px;background:#059669;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:bold;">
            Guardar como PDF / Imprimir
          </button>
        </div>
        <h1>Consolidado de Evaluación — Rúbrica UNIVO</h1>
        <div class="meta">
          Sesión: <strong>${escapeHtml(data.sessionId)}</strong> · Candidato: <strong>${escapeHtml(data.candidateName || "N/D")}</strong> · Fecha: ${new Date(data.timestamp).toLocaleString()}
        </div>
        <div class="summary">
          <div class="box">Promedio de dimensiones calificadas: <strong>${formatScore(data.quantitativeSummary.averageScore)}</strong></div>
          <div class="box">Dictamen: <strong>${data.overallVerdict ?? "Pendiente"}</strong></div>
          <div class="box">Escala: E:${data.quantitativeSummary.scaleDistribution.E} · MB:${data.quantitativeSummary.scaleDistribution.MB} · B:${data.quantitativeSummary.scaleDistribution.B} · R:${data.quantitativeSummary.scaleDistribution.R} · NM:${data.quantitativeSummary.scaleDistribution.NM}</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Dimensión</th>
              <th class="center">IA</th>
              <th class="center">Puntaje Final</th>
              <th class="center">Escala</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <div class="notes">
          <strong>Observaciones del Evaluador:</strong>
          <p style="margin:6px 0 0;">${escapeHtml(data.qualitativeObservations || "Sin observaciones adicionales.")}</p>
        </div>
        <script>
          window.onload = function() { setTimeout(function() { window.print(); }, 250); };
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();

    setStatusMessage({
      type: "info",
      text: "Vista de impresión abierta: selecciona 'Guardar como PDF' para descargarlo.",
    });
  };

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

  const handleScoreChange = (id: string, newScore: number | null) => {
    const clamped = newScore === null ? null : Math.round(Math.max(0, Math.min(100, newScore)));
    setDimensions((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, adjustedScore: clamped, scale: clamped === null ? null : scoreToScale(clamped) }
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

    const jsonPayload = buildEvaluationPayload();

    try {
      const result = await saveEvaluation(sessionId, jsonPayload);

      const location = result.source === "s3" ? "en AWS S3" : "en este equipo";
      setSavedPayload(JSON.stringify(jsonPayload, null, 2));
      setSuggestionsLoaded(true);
      setSavedLocation(location);
      setStatusMessage({
        type: "success",
        text: `Evaluación guardada ${location}.`,
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

  if (loadState === "loading") return <p role="status">Cargando rúbrica…</p>;
  if (loadState === "error") {
    return (
      <div className="space-y-2">
        <p role="alert">No se pudo consultar la evaluación guardada.</p>
        <button type="button" className="underline" onClick={() => {
          setLoadState("loading");
          setLoadAttempt((attempt) => attempt + 1);
        }}>
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Encabezado + KPIs rápidos + Descarga de rúbrica */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Consolidado de Evaluación</h2>
          <p className="text-xs text-slate-400">
            Guía de Observación UNIVO · Escala E / MB / B / R / NM + Reporte Cuantitativo y PNL
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-mono px-3 py-1 rounded-full bg-slate-900 text-emerald-400 border border-emerald-500/30">
            Promedio de dimensiones calificadas: {formatScore(metrics.avgScore)}
          </span>
          <span className="text-xs font-mono px-3 py-1 rounded-full bg-slate-900 text-slate-300 border border-slate-700">
            {sessionId}
          </span>
          <button
            type="button"
            onClick={handleDownloadRubric}
            disabled={suggesting}
            className="text-xs px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-emerald-300 font-medium border border-emerald-500/40 transition-colors cursor-pointer"
          >
            Descargar Rúbrica
          </button>
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

      <div className="space-y-2 text-sm text-slate-300">
        <p>Revisa las sugerencias y completa las dimensiones pendientes antes de usar el resultado.</p>
        {!hasTranscript && <p>No hay una transcripción guardada. Puedes calificar la sesión manualmente.</p>}
        {suggesting && <p role="status">Generando sugerencias a partir de la transcripción…</p>}
        {suggestionError && <p role="alert" className="text-rose-400">{suggestionError}</p>}
        {hasTranscript && !suggesting && !suggestionsLoaded && !savedPayload && (
          <button type="button" className="text-emerald-300 underline" onClick={() => void requestSuggestions()}>
            {suggestionError ? "Reintentar sugerencias" : "Generar sugerencias"}
          </button>
        )}
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
                  {item.aiScore === null
                    ? "Sin sugerencia"
                    : `${item.evidence ? "IA" : "IA anterior sin cita"}: ${item.aiScore}%`}
                </span>
              </div>
              <p className="text-[11px] text-emerald-400/90">{item.univoScope}</p>
              {item.feedback && <p className="text-xs text-slate-400">{item.feedback}</p>}
              {item.evidence && <blockquote className="text-xs text-slate-300">«{item.evidence}»</blockquote>}
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
                  value={item.adjustedScore ?? ""}
                  placeholder="—"
                  onChange={(e) => handleScoreChange(item.id, e.target.value === "" ? null : Number(e.target.value))}
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
          {legacyIndicators.length > 0 && (
            <>
              <PerformanceMetricsChart
                metrics={legacyIndicators.map(({ label, adjustedScore, feedback }) => (
                  { indicator: label, score: adjustedScore, feedback }
                ))}
              />
              <HybridRubricEditor
                indicators={legacyIndicators}
                onScoreChange={handleScoreChange}
              />
            </>
          )}
          {hasTranscript && <TechnicalTranscript segments={segments} vocabulary={vocabulary} />}
        </div>
      )}

      {/* Dictamen, observaciones y guardado */}
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
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSaveEvaluation}
              disabled={isSaving || suggesting}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors cursor-pointer"
            >
              {isSaving ? "Guardando evaluación..." : "Guardar Evaluación Consolidada"}
            </button>

            <button
              type="button"
              onClick={handleDownloadRubric}
              disabled={suggesting}
              className="px-4 py-2.5 rounded-lg border border-emerald-500/40 bg-slate-950 hover:bg-slate-800 text-emerald-300 font-medium text-sm transition-colors cursor-pointer"
            >
              Descargar Rúbrica
            </button>
          </div>

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
              Evaluación guardada {savedLocation}
            </p>
            <pre className="text-xs text-emerald-300 overflow-x-auto">{savedPayload}</pre>
          </div>
        )}
      </div>
    </div>
  );
};
