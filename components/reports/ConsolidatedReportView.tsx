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
  "Buen dominio técnico y vocabulario clave",
  "Fomentar mayor participación estudiantil",
  "Reforzar retroalimentación de errores",
];

const INITIAL_DIMENSIONS: DimensionItem[] = [
  {
    id: "innovacion_actualizacion",
    title: "Innovación y Actualización",
    univoScope:
      "Ítems 1–6 · Puntualidad, competencia, pre-saberes, dicción, recursos y vocabulario técnico",
    aiScore: 88,
    adjustedScore: 88,
    scale: "MB",
    feedback:
      "Buen ritmo vocal, uso de recursos tecnológicos y terminología técnica pertinente.",
  },
  {
    id: "calidad_ensenanza",
    title: "Calidad de la Enseñanza",
    univoScope:
      "Ítems 7–14 · Plan de clase, distribución del tiempo, dominio y estrategias",
    aiScore: 85,
    adjustedScore: 85,
    scale: "MB",
    feedback: "Estructura ordenada y explicación clara de conceptos clave.",
  },
  {
    id: "relacion_estudiantes",
    title: "Relación con los Estudiantes",
    univoScope:
      "Ítems 15–20 · Respeto, conducción, ejemplos vivenciales, interés y consultas",
    aiScore: 80,
    adjustedScore: 80,
    scale: "MB",
    feedback:
      "Trato cordial y atención a consultas; se puede ampliar participación.",
  },
  {
    id: "evaluacion_retroalimentacion",
    title: "Evaluación y Retroalimentación",
    univoScope:
      "Ítems 21–26 · Seguimiento, comprensión, retroalimentación y cierre",
    aiScore: 78,
    adjustedScore: 78,
    scale: "B",
    feedback:
      "Comprueba comprensión durante la sesión; reforzar síntesis final.",
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
  const [dimensions, setDimensions] =
    useState<DimensionItem[]>(INITIAL_DIMENSIONS);
  const [verdict, setVerdict] = useState<VerdictOption>("Cumple adecuadamente");
  const [qualitativeNotes, setQualitativeNotes] = useState("");
  const [savedPayload, setSavedPayload] = useState<string | null>(null);
  const [s3Key, setS3Key] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
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
                typeof match.finalScore === "number"
                  ? match.finalScore
                  : item.adjustedScore;
              return {
                ...item,
                aiScore:
                  typeof match.aiScore === "number" ? match.aiScore : item.aiScore,
                adjustedScore: nextScore,
                scale: match.scale || scoreToScale(nextScore),
              };
            })
          );
        }

        if (
          saved.overallVerdict &&
          VERDICT_OPTIONS.includes(saved.overallVerdict)
        ) {
          setVerdict(saved.overallVerdict);
        }
        if (typeof saved.qualitativeObservations === "string") {
          setQualitativeNotes(saved.qualitativeObservations);
        }

        setSavedPayload(JSON.stringify(saved, null, 2));
        setStatusMessage({
          type: "info",
          text: `Evaluación cargada desde ${
            data.source === "s3" ? "AWS S3" : "registro local"
          }.`,
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
    const avgScore =
      dimensions.length > 0
        ? Math.round(
            dimensions.reduce((acc, d) => acc + d.adjustedScore, 0) /
              dimensions.length
          )
        : 0;
    const counts: Record<UnivoScale, number> = {
      E: 0,
      MB: 0,
      B: 0,
      R: 0,
      NM: 0,
    };
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
      technicalTermsCount: sampleTerms.length,
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
      }) => ({
        id,
        label: title,
        univoScope,
        scale,
        aiScore,
        finalScore: adjustedScore,
        manuallyAdjusted: aiScore !== adjustedScore,
        feedback,
      })
    ),
    technicalTermsDetected: sampleTerms,
    qualitativeObservations: qualitativeNotes,
  });

  const handleDownloadRubric = () => {
    const data = buildEvaluationPayload();
    const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const fileTitle = `Rubrica_${safeSessionId}_${new Date()
      .toISOString()
      .slice(0, 10)}`;

    const rowsHtml = data.rubricScores
      .map(
        (r) => `
          <tr>
            <td style="padding:10px;border:1px solid #cbd5e1;">
              <strong>${r.label}</strong><br/>
              <span style="font-size:11px;color:#475569;">${r.univoScope}</span><br/>
              <span style="font-size:12px;color:#334155;">${r.feedback || ""}</span>
            </td>
            <td style="padding:10px;border:1px solid #cbd5e1;text-align:center;">${r.aiScore}%</td>
            <td style="padding:10px;border:1px solid #cbd5e1;text-align:center;font-weight:bold;">${r.finalScore}%</td>
            <td style="padding:10px;border:1px solid #cbd5e1;text-align:center;font-weight:bold;">${r.scale}</td>
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
          Sesión: <strong>${data.sessionId}</strong> · Candidato: <strong>${
      data.candidateName || "N/D"
    }</strong> · Fecha: ${new Date(data.timestamp).toLocaleString()}
        </div>
        <div class="summary">
          <div class="box">Promedio Final: <strong>${
            data.quantitativeSummary.averageScore
          }%</strong></div>
          <div class="box">Dictamen: <strong>${data.overallVerdict}</strong></div>
          <div class="box">Escala: E:${
            data.quantitativeSummary.scaleDistribution.E
          } · MB:${data.quantitativeSummary.scaleDistribution.MB} · B:${
      data.quantitativeSummary.scaleDistribution.B
    } · R:${data.quantitativeSummary.scaleDistribution.R} · NM:${
      data.quantitativeSummary.scaleDistribution.NM
    }</div>
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
          <p style="margin:6px 0 0;">${
            data.qualitativeObservations || "Sin observaciones adicionales."
          }</p>
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

    const jsonPayload = buildEvaluationPayload();

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
        err instanceof Error
          ? err.message
          : "No se pudo guardar la evaluación.";
      setStatusMessage({
        type: "error",
        text: `Error al guardar: ${message}`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
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
          <span className="rounded-full border border-emerald-500/30 bg-slate-900 px-3 py-1 font-mono text-xs text-emerald-400">
            Promedio: {metrics.avgScore}%
          </span>
          <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 font-mono text-xs text-slate-300">
            {sessionId}
          </span>
          <button
            type="button"
            onClick={handleDownloadRubric}
            className="cursor-pointer rounded-lg border border-emerald-500/40 bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-emerald-300 transition-colors hover:bg-slate-800"
          >
            Descargar Rúbrica
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/90 p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="mr-1 text-slate-400">Distribución:</span>
          {SCALE_OPTIONS.map((opt) => (
            <span
              key={opt.code}
              className="rounded-md border border-slate-800 bg-slate-950 px-2.5 py-1 font-mono text-slate-200"
              title={opt.label}
            >
              {opt.code}: <strong>{metrics.counts[opt.code]}</strong>
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {dimensions.map((item) => (
          <div
            key={item.id}
            className="flex flex-col justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900 p-4 md:flex-row md:items-center"
          >
            <div className="max-w-xl space-y-1">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                <span className="font-mono text-[11px] text-slate-400">
                  IA: {item.aiScore} → {item.adjustedScore}
                </span>
              </div>
              <p className="text-[11px] text-emerald-400/90">{item.univoScope}</p>
              <p className="text-xs text-slate-400">{item.feedback}</p>
            </div>

            <div className="flex flex-col items-start gap-2 md:items-end">
              <div className="flex items-center gap-1.5">
                {SCALE_OPTIONS.map((opt) => {
                  const active = item.scale === opt.code;
                  return (
                    <button
                      key={opt.code}
                      type="button"
                      onClick={() => handleScaleSelect(item.id, opt.code)}
                      title={`${opt.code} — ${opt.label}`}
                      className={`h-9 w-10 cursor-pointer rounded-lg border text-xs font-bold transition-colors ${
                        active
                          ? "border-emerald-400 bg-emerald-600 text-white"
                          : "border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-600"
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
                  onChange={(e) =>
                    handleScoreChange(item.id, Number(e.target.value))
                  }
                  className="w-16 rounded border border-slate-800 bg-slate-950 px-2 py-0.5 text-right font-mono text-xs text-slate-100"
                />
              </label>
            </div>
          </div>
        ))}
      </div>

      {/* Barras deslizables y vocabulario técnico visibles de un solo */}
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

      <div className="space-y-4 rounded-xl border border-emerald-500/30 bg-slate-900 p-6 text-white shadow-lg">
        <div>
          <h3 className="text-base font-semibold text-emerald-400">
            Dictamen y Observaciones del Evaluador
          </h3>
          <p className="text-xs text-slate-400">
            Selecciona el dictamen general, haz clic en etiquetas rápidas o
            escribe observaciones adicionales.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {VERDICT_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setVerdict(option)}
              className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-xs transition-colors ${
                verdict === option
                  ? "border-emerald-400 bg-emerald-600/20 font-semibold text-emerald-300"
                  : "border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200"
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {QUICK_TAGS.map((tag) => {
            const selected = qualitativeNotes.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => handleToggleTag(tag)}
                className={`cursor-pointer rounded-md border px-2.5 py-1 text-[11px] transition-colors ${
                  selected
                    ? "border-sky-400 bg-sky-500/20 text-sky-300"
                    : "border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700"
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
          className="h-24 w-full resize-none rounded-lg border border-slate-800 bg-slate-950 p-3.5 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
        />

        <div className="flex flex-wrap items-center justify-between gap-4">
          <button
            type="button"
            onClick={handleSaveEvaluation}
            disabled={isSaving}
            className="cursor-pointer rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
          >
            {isSaving
              ? "Guardando en S3..."
              : "Guardar Evaluación Consolidada"}
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
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-4">
            <p className="mb-2 font-mono text-xs text-slate-400">
              JSON persistido {s3Key ? `en S3 (${s3Key})` : ""}:
            </p>
            <pre className="overflow-x-auto text-xs text-emerald-300">
              {savedPayload}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};