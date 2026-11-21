'use client';

// ============================================================================
// US11 · Vista "Ver Reporte"
// Muestra las métricas consolidadas de la sesión, el veredicto y una línea de
// tiempo de eventos.
//
// ⚠ DATOS DE MUESTRA: todo se genera con `seedFromId` a partir del sessionId.
// TODO(backend): reemplazar `metrics`, `verdict` y `events` por la respuesta
// real del endpoint de reportes (la rama US05/US10 ya tiene backend FastAPI).
// ============================================================================

import { SessionData } from '../session/SessionForm';

interface ReportViewProps {
  session: SessionData | null;
}

// Deriva valores deterministas a partir del ID de sesión para simular
// datos históricos persistidos sin necesidad de un backend.
// (Misma sesión -> mismos datos, ideal para la demo. Eliminar al conectar la API.)
function seedFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) % 9973;
  }
  return h;
}

export function ReportView({ session }: ReportViewProps) {
  const seed = seedFromId(session?.sessionId || 'SES-DEMO');

  // MOCK: métricas simuladas. Sustituir por datos del reporte real.
  const metrics = [
    { label: 'Duración de la sesión', value: '14:32', suffix: 'min' },
    { label: 'Puntaje global', value: `${72 + (seed % 24)}`, suffix: '/100' },
    { label: 'Audio promedio', value: `${78 + (seed % 15)}`, suffix: '%' },
    { label: 'Eventos EDA detectados', value: `${3 + (seed % 4)}`, suffix: '' },
  ];

  const score = 72 + (seed % 24);
  const verdict =
    score >= 85
      ? { text: 'Altamente recomendado', tone: 'text-[#9ce4c1] border-[#9ce4c1]/30 bg-[#9ce4c1]/10' }
      : score >= 70
        ? { text: 'Recomendado', tone: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' }
        : { text: 'Requiere segunda evaluación', tone: 'text-amber-300 border-amber-500/30 bg-amber-500/10' };

  // MOCK: línea de tiempo simulada. Sustituir por los eventos EDA reales
  // registrados por el bus de eventos durante la sesión.
  const events = [
    { time: '00:42', text: 'Calibración de dispositivos completada.' },
    { time: '02:15', text: 'Evento EDA: nivel de atención óptimo.' },
    { time: '07:48', text: 'Sensor de audio: tono de voz estable.' },
    { time: '12:03', text: 'Evento EDA: postura corporal adecuada.' },
    { time: '14:32', text: 'Sesión finalizada por el evaluador.' },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Métricas principales */}
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
              <span className="ml-1 text-sm font-semibold text-[#9ce4c1]">{m.suffix}</span>
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Veredicto del reporte */}
        <div className="rounded-2xl border border-[rgba(194,220,213,0.12)] bg-[#11191e] p-6 shadow-xl">
          <span className="eyebrow">Resultado</span>
          <div
            className={`mt-3 inline-flex items-center rounded-full border px-4 py-2 text-sm font-bold ${verdict.tone}`}
          >
            {verdict.text}
          </div>
          <p className="mt-4 text-sm leading-relaxed text-[#82918f]">
            Reporte consolidado de la sesión {session?.sessionId}. Las métricas fueron
            recopiladas por el bus de eventos durante la demo class de{' '}
            {session?.candidateName || 'el candidato'}.
          </p>
        </div>

        {/* Línea de tiempo de eventos */}
        <div className="rounded-2xl border border-[rgba(194,220,213,0.12)] bg-[#11191e] p-6 shadow-xl lg:col-span-2">
          <span className="eyebrow">Línea de tiempo de eventos</span>
          <ul className="mt-3 space-y-3 font-mono text-xs">
            {events.map((e) => (
              <li key={e.time} className="flex items-center gap-3 text-[#e9f0ed]">
                <span className="rounded-md bg-[#0d1519] px-2 py-1 text-[#9ce4c1]">{e.time}</span>
                <span className="text-[#b6c4c1]">{e.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
