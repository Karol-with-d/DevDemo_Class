"use client";

import React, { useState } from 'react';
import { HybridRubricEditor, RubricIndicator } from './HybridRubricEditor';
import { NLPVocabularyViewer } from './NLPVocabularyViewer';

export const ConsolidatedReportView: React.FC = () => {
  // Datos iniciales autocompletados por la IA (Criterio 1 de US9)
  const [indicators, setIndicators] = useState<RubricIndicator[]>([
    { id: 'tiempo', label: 'Gestión del Tiempo', aiScore: 85, adjustedScore: 85, feedback: 'Duración óptima dentro del límite establecido.' },
    { id: 'movilidad', label: 'Movilidad y Lenguaje Corporal', aiScore: 78, adjustedScore: 78, feedback: 'Postura estable y contacto visual consistente.' },
    { id: 'ritmo', label: 'Ritmo de Habla', aiScore: 90, adjustedScore: 90, feedback: 'Velocidad clara y pausas bien estructuradas (135 ppm).' },
    { id: 'muletillas', label: 'Control de Muletillas', aiScore: 72, adjustedScore: 72, feedback: 'Se detectaron 4 pausas vocales ("eh", "este") durante la explicación.' },
    { id: 'vocabulario', label: 'Vocabulario Técnico (PNL)', aiScore: 92, adjustedScore: 92, feedback: 'Uso preciso de terminología de arquitectura y desarrollo.' },
  ]);

  const [qualitativeNotes, setQualitativeNotes] = useState('');
  const [savedPayload, setSavedPayload] = useState<string | null>(null);

  const sampleTranscript = "Durante la sesión implementamos un enfoque basado en componentes utilizando TypeScript, aplicando arquitecturas MVC y controlando el flujo de estados mediante hooks de React en el entorno de desarrollo.";
  const sampleTerms = ["TypeScript", "MVC", "hooks", "React", "componentes"];

  // Permitir ajuste manual del evaluador (Criterio 2 de US9)
  const handleScoreChange = (id: string, newScore: number) => {
    setIndicators((prev) =>
      prev.map((item) => (item.id === id ? { ...item, adjustedScore: newScore } : item))
    );
  };

  // Estructura JSON lista para persistir en PostgreSQL (Criterio 3 de US9)
  const handleSaveEvaluation = () => {
    const jsonPayload = {
      timestamp: new Date().toISOString(),
      rubricScores: indicators.map(({ id, label, aiScore, adjustedScore }) => ({
        id,
        label,
        aiScore,
        finalScore: adjustedScore,
        manuallyAdjusted: aiScore !== adjustedScore,
      })),
      nlpDetectedTerms: sampleTerms,
      qualitativeObservations: qualitativeNotes,
    };

    console.log("Payload JSON listo para PostgreSQL:", jsonPayload);
    setSavedPayload(JSON.stringify(jsonPayload, null, 2));
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h2 className="text-2xl font-bold text-white">Consolidado de Evaluación (US9 & US10)</h2>
        <p className="text-sm text-slate-400">Rúbrica híbrida editable, análisis de vocabulario PNL y observaciones cualitativas.</p>
      </div>

      {/* Sección 1: Rúbrica Autocompletada + Edición Manual (US9 + US10) */}
      <HybridRubricEditor indicators={indicators} onScoreChange={handleScoreChange} />

      {/* Sección 2: Reporte de Vocabulario Técnico PNL (US10) */}
      <NLPVocabularyViewer transcript={sampleTranscript} technicalTerms={sampleTerms} />

      {/* Sección 3: Observaciones Cualitativas y Guardado JSON (US9) */}
      <div className="bg-slate-900 text-white p-6 rounded-xl border border-emerald-500/30 shadow-lg space-y-4">
        <h3 className="text-lg font-semibold text-emerald-400">Observaciones Cualitativas del Evaluador</h3>
        <p className="text-xs text-slate-400">
          Registre aspectos no automatizables (dominio pedagógico, actitud, claridad conceptual) para consolidar el dictamen.
        </p>

        <textarea
          value={qualitativeNotes}
          onChange={(e) => setQualitativeNotes(e.target.value)}
          placeholder="Escriba aquí sus observaciones cualitativas sobre el desempeño del candidato..."
          className="w-full h-28 bg-slate-950 text-slate-100 p-4 rounded-lg border border-slate-800 focus:outline-none focus:border-emerald-500 text-sm resize-none"
        />

        <div className="flex items-center justify-between">
          <button
            onClick={handleSaveEvaluation}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors cursor-pointer"
          >
            Guardar Evaluación Consolidada
          </button>
          {savedPayload && (
            <span className="text-xs text-emerald-400 font-semibold">
              ✓ Evaluación guardada y estructurada en JSON
            </span>
          )}
        </div>

        {/* Vista previa del JSON generado para demostrar el Criterio 3 de US9 */}
        {savedPayload && (
          <div className="mt-4 bg-slate-950 p-4 rounded-lg border border-slate-800">
            <p className="text-xs text-slate-400 mb-2 font-mono">Estructura JSON generada para persistencia (PostgreSQL):</p>
            <pre className="text-xs text-emerald-300 overflow-x-auto">{savedPayload}</pre>
          </div>
        )}
      </div>
    </div>
  );
};