'use client';

// ============================================================================
// US11 · Vista "Galería de Videos"
// Grid de grabaciones de la sesión con miniatura, duración y selección.
//
// ⚠ DATOS DE MUESTRA: los clips son falsos — actualmente la app NO graba video
// real (no hay MediaRecorder ni backend en esta rama).
// TODO(backend): reemplazar CLIPS por las grabaciones reales de la sesión.
// La rama feature/US05-analisis-corporal ya guarda videos en S3 y tiene un
// componente similar: frontend/components/recordings/RecordingsLibrary.tsx
// ============================================================================

import { useState } from 'react';
import { SessionData } from '../session/SessionForm';

interface VideoGalleryProps {
  session: SessionData | null;
}

// MOCK: lista fija de clips simulados.
const CLIPS = [
  { id: 1, title: 'Demo principal', duration: '14:32', tag: 'Completa' },
  { id: 2, title: 'Prueba de calibración', duration: '00:42', tag: 'Calibración' },
  { id: 3, title: 'Preguntas del evaluador', duration: '05:18', tag: 'Q&A' },
  { id: 4, title: 'Cierre y feedback', duration: '03:05', tag: 'Cierre' },
];

// Gradientes de miniatura simulada — con videos reales se usaría un <video>
// con poster/thumbnail generado por el backend.
const THUMB_STYLES = [
  'from-[#16302c] via-[#0f1a1c] to-[#0b1014]',
  'from-[#1c2a35] via-[#101a1e] to-[#0b1014]',
  'from-[#22301f] via-[#121a16] to-[#0b1014]',
  'from-[#2a2438] via-[#15161f] to-[#0b1014]',
];

export function VideoGallery({ session }: VideoGalleryProps) {
  // Clip seleccionado (solo marca visual "Reproduciendo" — no reproduce nada
  // porque los videos son de muestra).
  const [selectedId, setSelectedId] = useState<number>(1);

  return (
    <div className="rounded-2xl border border-[rgba(194,220,213,0.12)] bg-[#11191e] p-6 shadow-xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(194,220,213,0.1)] pb-4">
        <div>
          <span className="eyebrow">Galería de Videos</span>
          <h3 className="font-manrope text-lg font-bold text-white">
            Grabaciones de {session?.candidateName || 'la sesión'}
          </h3>
        </div>
        <span className="rounded-full bg-[#0d1519] px-3 py-1.5 text-xs font-semibold text-[#82918f]">
          {CLIPS.length} grabaciones · {session?.sessionId || 'SES-000000'}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {CLIPS.map((clip, i) => {
          const isSelected = selectedId === clip.id;
          return (
            <button
              key={clip.id}
              onClick={() => setSelectedId(clip.id)}
              className={`group cursor-pointer overflow-hidden rounded-xl border text-left transition-all duration-150 ${
                isSelected
                  ? 'border-[#9ce4c1]/60 shadow-[0_0_20px_rgba(156,228,193,0.12)]'
                  : 'border-white/10 hover:border-white/25'
              }`}
            >
              {/* Miniatura del video */}
              <div
                className={`relative aspect-video bg-gradient-to-br ${THUMB_STYLES[i % THUMB_STYLES.length]} flex items-center justify-center`}
              >
                <span className="absolute left-2 top-2 rounded-md bg-black/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#9ce4c1]">
                  {clip.tag}
                </span>
                <span
                  className={`flex h-11 w-11 items-center justify-center rounded-full border transition-all duration-150 ${
                    isSelected
                      ? 'border-[#9ce4c1] bg-[#9ce4c1] text-[#0b1014]'
                      : 'border-white/30 bg-black/40 text-white group-hover:bg-[#9ce4c1] group-hover:text-[#0b1014] group-hover:border-[#9ce4c1]'
                  }`}
                >
                  <svg className="ml-0.5 h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M4 2.5v11l9-5.5-9-5.5z" />
                  </svg>
                </span>
                <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-2 py-0.5 font-mono text-[10px] font-bold text-white">
                  {clip.duration}
                </span>
              </div>
              <div className="bg-[#0d1519] px-3 py-2.5">
                <p className="truncate text-xs font-semibold text-[#e9f0ed]">{clip.title}</p>
                <p className="mt-0.5 text-[10px] text-[#5b6b68]">
                  {isSelected ? 'Reproduciendo' : 'Click para reproducir'}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
