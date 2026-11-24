'use client';

import { useState, useEffect } from 'react';

export interface SessionData {
  sessionId: string;
  candidateName: string;
  evaluatorName: string;
  technology: string;
  complexity: string;
}

interface SessionSetupProps {
  onSessionReady: (data: SessionData) => void;
}

const inputBase =
  'w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-[#e9f0ed] ' +
  'placeholder:text-[#5b6b68] outline-none transition-all duration-200 ' +
  'hover:border-white/20 focus:border-[#9ce4c1]/70 focus:bg-white/[0.05] focus:ring-4 focus:ring-[#9ce4c1]/10';

const labelBase =
  'mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8a9b97]';

const optionClass = 'bg-[#0f171c] text-[#e9f0ed]';

function ChevronIcon() {
  return (
    <svg
      className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a9b97]"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M5 7.5l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SessionSetup({ onSessionReady }: SessionSetupProps) {
  const [sessionId, setSessionId] = useState<string>('');
  const [candidateName, setCandidateName] = useState('');
  const [evaluatorName, setEvaluatorName] = useState('');
  const [technology, setTechnology] = useState('JavaScript / TypeScript');
  const [complexity, setComplexity] = useState('Básico');

  useEffect(() => {
    setSessionId(`SES-${Math.random().toString(36).substring(2, 8).toUpperCase()}`);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!candidateName.trim() || !evaluatorName.trim()) return;
    onSessionReady({
      sessionId,
      candidateName: candidateName.trim(),
      evaluatorName: evaluatorName.trim(),
      technology,
      complexity,
    });
  };

  return (
    <div className="relative w-full overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-[#141f25] to-[#0f171c] p-8 text-white shadow-[0_20px_60px_-15px_rgba(0,0,0,0.7)] sm:p-10">
      {/* Resplandor decorativo */}
      <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-80 -translate-x-1/2 rounded-full bg-[#9ce4c1]/10 blur-3xl" />

      {/* Cabecera */}
      <div className="relative mb-8">
        <div className="mb-4 flex items-center gap-2">
          <div className="h-1 w-10 rounded-full bg-[#9ce4c1]" />
          <div className="h-1 w-10 rounded-full bg-white/10" />
          <div className="h-1 w-10 rounded-full bg-white/10" />
          <span className="ml-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9ce4c1]">
            Paso 1 de 3
          </span>
        </div>
        <h2 className="text-2xl font-bold tracking-tight">Configuración de sesión</h2>
        <p className="mt-1.5 text-sm text-[#8a9b97]">
          Completa los datos para preparar la evaluación.
        </p>
      </div>

      {/* Formulario */}
      <form onSubmit={handleSubmit} className="relative flex flex-col gap-5">
        <div>
          <label htmlFor="candidate" className={labelBase}>
            Nombre del candidato
          </label>
          <input
            id="candidate"
            type="text"
            required
            placeholder="Ej. Juan Pérez"
            value={candidateName}
            onChange={(e) => setCandidateName(e.target.value)}
            className={inputBase}
          />
        </div>

        <div>
          <label htmlFor="evaluator" className={labelBase}>
            Nombre del evaluador
          </label>
          <input
            id="evaluator"
            type="text"
            required
            placeholder="Ej. Ana Gómez"
            value={evaluatorName}
            onChange={(e) => setEvaluatorName(e.target.value)}
            className={inputBase}
          />
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="tech" className={labelBase}>
              Tecnología
            </label>
            <div className="relative">
              <select
                id="tech"
                value={technology}
                onChange={(e) => setTechnology(e.target.value)}
                className={`${inputBase} cursor-pointer appearance-none pr-10 [color-scheme:dark]`}
              >
                <option value="JavaScript / TypeScript" className={optionClass}>
                  JavaScript / TS
                </option>
                <option value="React / Next.js" className={optionClass}>
                  React / Next.js
                </option>
                <option value="Python / FastAPI" className={optionClass}>
                  Python / FastAPI
                </option>
                <option value="Node.js / Express" className={optionClass}>
                  Node.js / Express
                </option>
              </select>
              <ChevronIcon />
            </div>
          </div>

          <div>
            <label htmlFor="complexity" className={labelBase}>
              Complejidad
            </label>
            <div className="relative">
              <select
                id="complexity"
                value={complexity}
                onChange={(e) => setComplexity(e.target.value)}
                className={`${inputBase} cursor-pointer appearance-none pr-10 [color-scheme:dark]`}
              >
                <option value="Básico" className={optionClass}>
                  Básico
                </option>
                <option value="Intermedio" className={optionClass}>
                  Intermedio
                </option>
                <option value="Avanzado" className={optionClass}>
                  Avanzado
                </option>
              </select>
              <ChevronIcon />
            </div>
          </div>
        </div>

        <button
          type="submit"
          className="group mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#9ce4c1] px-5 py-3.5 text-sm font-bold text-[#0b1014] shadow-lg shadow-[#9ce4c1]/10 transition-all duration-200 hover:bg-[#b1f0d2] hover:shadow-[#9ce4c1]/25 active:scale-[0.99]"
        >
          Guardar y continuar a calibración
          <svg
            className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M4 10h12m0 0l-5-5m5 5l-5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </form>
    </div>
  );
}