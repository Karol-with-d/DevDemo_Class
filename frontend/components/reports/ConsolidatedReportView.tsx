"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { HybridRubricEditor, RubricIndicator } from "./HybridRubricEditor";
import {
  getEvaluation,
  getRubricSuggestions,
  saveEvaluation,
  type RubricSuggestion,
  type TechnicalTerm,
  type TranscriptSegment,
} from "../../lib/api";
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

const VERDICT_RANGES: {
  option: VerdictOption;
  min: number;
  max: number;
  rangeLabel: string;
}[] = [
  { option: "Excelente / Destacado", min: 90, max: 100, rangeLabel: "90% – 100%" },
  { option: "Cumple adecuadamente", min: 75, max: 89, rangeLabel: "75% – 89%" },
  { option: "Debe mejorar", min: 60, max: 74, rangeLabel: "60% – 74%" },
  { option: "Requiere seguimiento", min: 0, max: 59, rangeLabel: "0% – 59%" },
];

const QUICK_TAGS = [
  "Buena activación de saberes previos",
  "Manejo claro del tiempo y cierre",
  "Buen dominio técnico y vocabulario clave",
  "Fomentar mayor participación estudiantil",
  "Reforzar retroalimentación de errores",
];

const INITIAL_DIMENSIONS: DimensionItem[] = rubric.map(
  ({ id, title, univoScope }) => ({
    id,
    title,
    univoScope,
    aiScore: null,
    adjustedScore: null,
    scale: null,
    feedback: "",
    evidence: null,
  })
);

function scoreToScale(score: number): UnivoScale {
  if (score >= 92) return "E";
  if (score >= 82) return "MB";
  if (score >= 72) return "B";
  if (score >= 60) return "R";
  return "NM";
}

function scoreToVerdict(avgScore: number | null): VerdictOption | null {
  if (avgScore === null) return null;
  const match = VERDICT_RANGES.find(
    (range) => avgScore >= range.min && avgScore <= range.max
  );
  return match ? match.option : "Requiere seguimiento";
}

function applySuggestions(
  dimensions: DimensionItem[],
  suggestions: RubricSuggestion[]
) {
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

function formatScore(score: number | null) {
  return score === null ? "Sin evaluar" : `${score}%`;
}

function savedScore(value: unknown) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
    ? value
    : null;
}

export const ConsolidatedReportView: React.FC<ConsolidatedReportViewProps> = ({
  sessionId,
  autoSuggest = false,
  candidateName = "Candidato",
  evaluatorName = "",
  technology = "",
  complexity = "",
}) => {
  const [dimensions, setDimensions] =
    useState<DimensionItem[]>(INITIAL_DIMENSIONS);
  const [qualitativeNotes, setQualitativeNotes] = useState("");
  const [savedPayload, setSavedPayload] = useState<string | null>(null);
  const [savedLocation, setSavedLocation] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [vocabulary, setVocabulary] = useState<TechnicalTerm[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);

  const requestSuggestions = useCallback(
    async (signal?: AbortSignal) => {
      setSuggesting(true);
      setSuggestionError(null);
      try {
        const { dimensions: suggestions } = await getRubricSuggestions(
          sessionId,
          signal
        );
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
    },
    [sessionId]
  );

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    async function load() {
      let context;
      try {
        context = await getEvaluation(sessionId, signal);
      } catch {
        if (!signal.aborted) {
          setStatusMessage({
            type: "info",
            text: "No se pudo consultar una evaluación previa (el servidor respondió con error). Puedes calificar manualmente.",
          });
          setLoadState("ready");
        }
        return;
      }
      if (signal.aborted) return;

      setSegments(context.segments);
      setVocabulary(context.vocabulary);
      const saved = context.evaluation;
      if (saved) {
        const scores = Array.isArray(saved.rubricScores)
          ? saved.rubricScores
          : [];
        setDimensions(
          INITIAL_DIMENSIONS.map((item) => {
            const score = scores.find((entry) => entry?.id === item.id);
            if (!score) return item;
            const adjustedScore = savedScore(score.finalScore);
            const savedScale = SCALE_OPTIONS.find(
              ({ code }) => code === score.scale
            );
            return {
              ...item,
              aiScore: savedScore(score.aiScore),
              adjustedScore,
              scale:
                adjustedScore === null
                  ? null
                  : savedScale?.code ?? scoreToScale(adjustedScore),
              feedback:
                typeof score.feedback === "string" ? score.feedback : "",
              evidence:
                typeof score.evidence === "string" ? score.evidence : null,
            };
          })
        );
        if (typeof saved.qualitativeObservations === "string") {
          setQualitativeNotes(saved.qualitativeObservations);
        }
        setSavedPayload(JSON.stringify(saved, null, 2));
        setSavedLocation(
          context.source === "s3" ? "en AWS S3" : "en este equipo"
        );
        setSuggestionsLoaded(true);
      }

      setLoadState("ready");
      if (
        !saved &&
        autoSuggest &&
        context.segments.some(({ text }) => text.trim())
      ) {
        await requestSuggestions(signal);
      }
    }

    void load();
    return () => controller.abort();
  }, [sessionId, autoSuggest, loadAttempt, requestSuggestions]);

  const metrics = useMemo(() => {
    const scores = dimensions.flatMap(({ adjustedScore }) =>
      adjustedScore === null ? [] : [adjustedScore]
    );
    const avgScore = scores.length
      ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
      : null;
    const counts: Record<UnivoScale, number> = { E: 0, MB: 0, B: 0, R: 0, NM: 0 };
    for (const { scale } of dimensions) {
      if (scale) counts[scale] += 1;
    }
    return { avgScore, counts };
  }, [dimensions]);

  const computedVerdict = useMemo(
    () => scoreToVerdict(metrics.avgScore),
    [metrics.avgScore]
  );

  const alwaysVisibleIndicators: RubricIndicator[] = useMemo(
    () =>
      dimensions.map((item) => ({
        id: item.id,
        label: item.title,
        aiScore: item.aiScore,
        adjustedScore: item.adjustedScore ?? 0,
        feedback:
          item.feedback ||
          (item.adjustedScore === null
            ? "Pendiente de evaluación. Selecciona una escala o desliza para asignar puntaje."
            : ""),
      })),
    [dimensions]
  );

  const evaluatedIndicators = useMemo(
    () =>
      dimensions.flatMap((item) =>
        item.adjustedScore === null
          ? []
          : [
              {
                indicator: item.title,
                score: item.adjustedScore,
                feedback: item.feedback,
              },
            ]
      ),
    [dimensions]
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
    overallVerdict: computedVerdict,
    quantitativeSummary: {
      averageScore: metrics.avgScore,
      scaleDistribution: metrics.counts,
      nlpTermsCount: terms.length,
    },
    timestamp: new Date().toISOString(),
    rubricScores: dimensions.map(
      ({
        id,
        title,
        univoScope,
        aiScore,
        adjustedScore,
        scale,
        feedback,
        evidence,
      }) => ({
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

  const handleDownloadRubricPdf = async () => {
    try {
      const { jsPDF } = await import("jspdf");
      const data = buildEvaluationPayload();
      const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
      const fileName = `Rubrica_${safeSessionId}_${new Date()
        .toISOString()
        .slice(0, 10)}.pdf`;

      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 15;
      const contentWidth = pageWidth - margin * 2;
      let y = 18;

      const ensureSpace = (neededHeight: number) => {
        if (y + neededHeight > pageHeight - 16) {
          doc.addPage();
          y = 18;
        }
      };

      doc.setFillColor(15, 23, 42);
      doc.rect(margin, y - 6, contentWidth, 22, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("Consolidado de Evaluación — Rúbrica UNIVO", margin + 4, y + 2);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(203, 213, 225);
      doc.text(
        `Sesión: ${data.sessionId}  |  Candidato: ${
          data.candidateName || "N/D"
        }  |  Fecha: ${new Date(data.timestamp).toLocaleString()}`,
        margin + 4,
        y + 10
      );
      y += 23;

      doc.setDrawColor(203, 213, 225);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(margin, y, contentWidth, 18, 2, 2, "FD");

      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(
        `Promedio Final: ${formatScore(data.quantitativeSummary.averageScore)}`,
        margin + 4,
        y + 7
      );
      doc.text(
        `Dictamen Automático: ${data.overallVerdict ?? "Pendiente de evaluación"}`,
        margin + 68,
        y + 7
      );

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      const dist = data.quantitativeSummary.scaleDistribution;
      doc.text(
        `Distribución por escala:  E: ${dist.E}   ·   MB: ${dist.MB}   ·   B: ${dist.B}   ·   R: ${dist.R}   ·   NM: ${dist.NM}`,
        margin + 4,
        y + 14
      );
      y += 25;

      doc.setFillColor(226, 232, 240);
      doc.rect(margin, y, contentWidth, 8, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(15, 23, 42);
      doc.text("Dimensión y Criterios", margin + 3, y + 5.5);
      doc.text("Sug. IA", margin + 122, y + 5.5, { align: "center" });
      doc.text("Final", margin + 145, y + 5.5, { align: "center" });
      doc.text("Escala", margin + 168, y + 5.5, { align: "center" });
      y += 8;

      for (const r of data.rubricScores) {
        const titleLines = doc.splitTextToSize(r.label, 105);
        const scopeLines = doc.splitTextToSize(r.univoScope, 105);
        const detailText = [
          r.feedback,
          r.evidence ? `Cita: "${r.evidence}"` : "",
        ]
          .filter(Boolean)
          .join(" — ");
        const detailLines = detailText
          ? doc.splitTextToSize(detailText, 105)
          : [];

        const rowHeight = Math.max(
          14,
          titleLines.length * 4.5 +
            scopeLines.length * 4 +
            detailLines.length * 4 +
            6
        );

        ensureSpace(rowHeight);

        doc.setDrawColor(203, 213, 225);
        doc.rect(margin, y, contentWidth, rowHeight);

        let textY = y + 5;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9.5);
        doc.setTextColor(15, 23, 42);
        doc.text(titleLines, margin + 3, textY);
        textY += titleLines.length * 4.5;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(5, 150, 105);
        doc.text(scopeLines, margin + 3, textY);
        textY += scopeLines.length * 4;

        if (detailLines.length > 0) {
          doc.setTextColor(71, 85, 105);
          doc.text(detailLines, margin + 3, textY);
        }

        const midY = y + rowHeight / 2 + 1.5;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(51, 65, 85);
        doc.text(
          r.aiScore === null ? "Manual" : `${r.aiScore}%`,
          margin + 122,
          midY,
          { align: "center" }
        );

        doc.setFont("helvetica", "bold");
        doc.setTextColor(15, 23, 42);
        doc.text(formatScore(r.finalScore), margin + 145, midY, {
          align: "center",
        });
        doc.text(r.scale ?? "—", margin + 168, midY, { align: "center" });

        y += rowHeight;
      }

      y += 6;

      const notesText =
        data.qualitativeObservations.trim() || "Sin observaciones adicionales.";
      const notesLines = doc.splitTextToSize(notesText, contentWidth - 8);
      const notesBoxHeight = notesLines.length * 4.5 + 12;
      ensureSpace(notesBoxHeight);

      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(203, 213, 225);
      doc.roundedRect(margin, y, contentWidth, notesBoxHeight, 2, 2, "FD");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(15, 23, 42);
      doc.text("Observaciones del Evaluador:", margin + 4, y + 6);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(51, 65, 85);
      doc.text(notesLines, margin + 4, y + 12);

      doc.save(fileName);

      setStatusMessage({
        type: "success",
        text: `PDF descargado: ${fileName}`,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "No se pudo generar el PDF.";
      setStatusMessage({
        type: "error",
        text: `Error al descargar PDF: ${msg}`,
      });
    }
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
    const clamped =
      newScore === null
        ? null
        : Math.round(Math.max(0, Math.min(100, newScore)));
    setDimensions((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              adjustedScore: clamped,
              scale: clamped === null ? null : scoreToScale(clamped),
            }
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

  if (loadState === "loading")
    return <p role="status">Cargando transcripción y rúbrica…</p>;
  if (loadState === "error") {
    return (
      <div className="space-y-2">
        <p role="alert">No se pudo consultar la evaluación guardada.</p>
        <button
          type="button"
          className="underline"
          onClick={() => {
            setLoadState("loading");
            setLoadAttempt((attempt) => attempt + 1);
          }}
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-2xl font-bold text-white">
            Consolidado de Evaluación
          </h2>
          <p className="text-xs text-slate-400">
            Guía de Observación UNIVO · Escala E / MB / B / R / NM · Resumen
            Cuantitativo y Vocabulario Técnico
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
            onClick={() => void handleDownloadRubricPdf()}
            disabled={suggesting}
            className="text-xs px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-emerald-300 font-medium border border-emerald-500/40 transition-colors cursor-pointer disabled:opacity-50"
          >
            Descargar Rúbrica (PDF)
          </button>
        </div>
      </div>

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
      </div>

      <div className="space-y-2 text-sm text-slate-300">
        <p>
          Revisa las sugerencias y completa las dimensiones pendientes antes de
          usar el resultado.
        </p>
        {!hasTranscript && (
          <p>
            No hay una transcripción guardada. Puedes calificar la sesión
            manualmente.
          </p>
        )}
        {suggesting && (
          <p role="status">
            Generando sugerencias a partir de la transcripción…
          </p>
        )}
        {suggestionError && (
          <p role="alert" className="text-rose-400">
            {suggestionError}
          </p>
        )}
        {hasTranscript && !suggesting && !suggestionsLoaded && !savedPayload && (
          <button
            type="button"
            className="text-emerald-300 underline"
            onClick={() => void requestSuggestions()}
          >
            {suggestionError ? "Reintentar sugerencias" : "Generar sugerencias"}
          </button>
        )}
      </div>

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
                    : `${item.evidence ? "IA" : "IA anterior sin cita"}: ${
                        item.aiScore
                      }%`}
                </span>
              </div>
              <p className="text-[11px] text-emerald-400/90">
                {item.univoScope}
              </p>
              {item.feedback && (
                <p className="text-xs text-slate-400">{item.feedback}</p>
              )}
              {item.evidence && (
                <blockquote className="text-xs text-slate-300">
                  «{item.evidence}»
                </blockquote>
              )}
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
                  onChange={(e) =>
                    handleScoreChange(
                      item.id,
                      e.target.value === "" ? null : Number(e.target.value)
                    )
                  }
                  className="w-16 bg-slate-950 border border-slate-800 rounded px-2 py-0.5 text-right text-slate-100 font-mono text-xs"
                />
              </label>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-4 pt-2">
        {evaluatedIndicators.length > 0 && (
          <PerformanceMetricsChart metrics={evaluatedIndicators} />
        )}
        <HybridRubricEditor
          indicators={alwaysVisibleIndicators}
          onScoreChange={handleScoreChange}
        />
        {hasTranscript && (
          <TechnicalTranscript segments={segments} vocabulary={vocabulary} />
        )}
      </div>

      <div className="bg-slate-900 text-white p-6 rounded-xl border border-emerald-500/30 shadow-lg space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-emerald-400">
              Dictamen y Observaciones del Evaluador
            </h3>
            <p className="text-xs text-slate-400">
              El dictamen se asigna automáticamente según el promedio obtenido
              para garantizar coherencia evaluativa.
            </p>
          </div>
          <span className="text-xs font-mono px-3 py-1 rounded-full bg-slate-950 border border-emerald-500/40 text-emerald-300">
            {computedVerdict ?? "Pendiente de calificación"}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {VERDICT_RANGES.map(({ option, rangeLabel }) => {
            const isMatched = computedVerdict === option;
            return (
              <div
                key={option}
                aria-current={isMatched ? "true" : undefined}
                className={`rounded-lg border px-3 py-2 text-xs transition-colors ${
                  isMatched
                    ? "bg-emerald-600/20 border-emerald-400 text-emerald-300 font-semibold"
                    : "bg-slate-950/70 border-slate-800 text-slate-500"
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span>{option}</span>
                  {isMatched && <span>✓</span>}
                </div>
                <span className="block font-mono text-[11px] opacity-80 mt-0.5">
                  Rango: {rangeLabel}
                </span>
              </div>
            );
          })}
        </div>

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
              {isSaving
                ? "Guardando evaluación..."
                : "Guardar Evaluación Consolidada"}
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
            <pre className="text-xs text-emerald-300 overflow-x-auto">
              {savedPayload}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
