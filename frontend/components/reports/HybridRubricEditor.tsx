"use client";

import React from "react";

export interface RubricIndicator {
  id: string;
  label: string;
  aiScore: number | null;
  adjustedScore: number;
  feedback: string;
}

interface Props {
  indicators: RubricIndicator[];
  onScoreChange: (id: string, newScore: number) => void;
}

export const HybridRubricEditor: React.FC<Props> = ({ indicators, onScoreChange }) => {
  const averageScore =
    indicators.length > 0
      ? Math.round(
          indicators.reduce((acc, item) => acc + item.adjustedScore, 0) / indicators.length
        )
      : 0;

  return (
    <div className="bg-slate-900 text-white p-6 rounded-xl border border-emerald-500/30 shadow-lg">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <div>
          <h3 className="text-lg font-semibold text-emerald-400">
            Rúbrica Evaluativa Híbrida (IA + Ajuste Manual)
          </h3>
          <p className="text-xs text-slate-400">
            Valores autocompletados por IA. Deslice o edite el valor numérico para calibrar la nota final.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs bg-emerald-500/10 text-emerald-300 px-3 py-1 rounded-full border border-emerald-500/30">
            Promedio Final: {averageScore}%
          </span>
        </div>
      </div>

      <div className="space-y-5">
        {indicators.map((item) => {
          const isModified = item.aiScore !== item.adjustedScore;
          return (
            <div
              key={item.id}
              className="bg-slate-950/60 p-4 rounded-lg border border-slate-800 space-y-2"
            >
              <div className="flex flex-wrap justify-between items-center gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-100">{item.label}</span>
                  {isModified && (
                    <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded border border-amber-500/30">
                    {item.aiScore === null ? "Manual" : `Editado (IA: ${item.aiScore}%)`}
                    </span>
                  )}
                </div>

                {/* Control numérico editable (US9) */}
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={item.adjustedScore}
                    onChange={(e) =>
                      onScoreChange(
                        item.id,
                        Math.min(100, Math.max(0, Number(e.target.value)))
                      )
                    }
                    className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-right font-bold text-emerald-400 focus:outline-none focus:border-emerald-500"
                  />
                  <span className="text-slate-400 font-bold">%</span>
                </div>
              </div>

              {/* Barra visual + Slider interactivo (US9 + US10) */}
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={item.adjustedScore}
                  onChange={(e) => onScoreChange(item.id, Number(e.target.value))}
                  className="w-full accent-emerald-500 cursor-pointer h-2 bg-slate-800 rounded-lg"
                />
              </div>

              <p className="text-xs text-slate-400">{item.feedback}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
};
