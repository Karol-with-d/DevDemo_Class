"use client";

// ============================================================================
// US11 · Vista "Ver Rúbrica"
// Tabla de criterios de evaluación con pesos, puntajes por criterio y el
// puntaje ponderado total.
//
// ⚠ DATOS DE MUESTRA: los criterios son fijos (CRITERIA) y los puntajes se
// simulan con `seedFromId`.
// TODO(backend): integrar HybridRubricEditor / ConsolidatedReportView de la
// rama feature/US10-reporte-cuantitativo (rúbrica UNIVO editable con puntajes
// reales del evaluador).
// ============================================================================

import { SessionData } from "../session/SessionForm";

interface RubricViewProps {
  session: SessionData | null;
}

// Genera valores deterministas por sesión para la demo.
// Eliminar al conectar la rúbrica real.
function seedFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) % 9973;
  }
  return h;
}

// MOCK: criterios de ejemplo. La rúbrica real debería variar según la
// tecnología y complejidad seleccionadas en el Paso 1.
const CRITERIA = [
  { name: "Comunicación verbal", desc: "Claridad, fluidez y vocabulario técnico", weight: 25 },
  { name: "Dominio técnico", desc: "Precisión de los conceptos demostrados", weight: 30 },
  { name: "Resolución de problemas", desc: "Respuesta ante imprevistos en vivo", weight: 20 },
  { name: "Lenguaje corporal y postura", desc: "Señales EDA y presencia en cámara", weight: 15 },
  { name: "Gestión del tiempo", desc: "Uso del tiempo asignado a la demo", weight: 10 },
];

export function RubricView({ session }: RubricViewProps) {
  const seed = seedFromId(session?.sessionId || "SES-DEMO");

  // Puntajes simulados (60-96) por criterio, deterministas por sesión.
  const rows = CRITERIA.map((c, i) => ({
    ...c,
    score: 60 + ((seed + i * 17) % 37),
  }));

  // Puntaje final = suma ponderada por el peso (weight) de cada criterio.
  const weightedTotal = Math.round(
    rows.reduce((acc, r) => acc + (r.score * r.weight) / 100, 0),
  );

  return (
    <div className="rounded-2xl border border-[rgba(194,220,213,0.12)] bg-[#11191e] p-6 shadow-xl">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-[rgba(194,220,213,0.1)] pb-4">
        <div>
          <span className="eyebrow">Rúbrica de evaluación</span>
          <h3 className="font-manrope text-lg font-bold text-white">
            {session?.technology || "Tecnología"} · Nivel {session?.complexity || "—"}
          </h3>
        </div>
        <div className="text-right">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#82918f]">
            Puntaje ponderado
          </span>
          <p className="font-manrope text-2xl font-extrabold text-[#9ce4c1]">
            {weightedTotal}/100
          </p>
        </div>
      </div>

      <div className="flex flex-col divide-y divide-[rgba(194,220,213,0.08)]">
        {rows.map((row) => (
          <div key={row.name} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:gap-6">
            <div className="sm:w-64 sm:flex-shrink-0">
              <p className="text-sm font-semibold text-[#e9f0ed]">{row.name}</p>
              <p className="text-xs text-[#82918f]">{row.desc}</p>
            </div>
            <div className="flex flex-1 items-center gap-3">
              <div className="progress-track flex-1">
                <div className="progress-fill" style={{ width: `${row.score}%` }} />
              </div>
              <span className="w-10 text-right font-mono text-sm font-bold text-[#9ce4c1]">
                {row.score}
              </span>
              <span className="w-10 text-right font-mono text-[11px] text-[#5b6b68]">
                {row.weight}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
