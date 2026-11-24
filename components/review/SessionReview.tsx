'use client';

// ============================================================================
// US11 — Navegación fluida entre vistas (Épica 5: Galería y Gestión de Grabaciones)
//
// Contenedor de la "Auditoría de Sesión": barra superior con 3 pestañas
// (Reporte / Rúbrica / Galería) que conmutan INSTANTÁNEAMENTE vía useState,
// sin recargar la página ni usar el router de Next.js.
//
// IMPORTANTE: las tres vistas (ReportView, RubricView, VideoGallery) muestran
// DATOS DE MUESTRA. Cuando exista el backend de grabaciones/reportes,
// reemplazar la data mock de cada vista por datos reales de la API.
// ============================================================================

import { useState } from 'react';
import { SessionData } from '../session/SessionForm';
import { ReportView } from './ReportView';
import { RubricView } from './RubricView';
import { VideoGallery } from './VideoGallery';

// Identificadores internos de cada pestaña.
type ReviewTab = 'report' | 'rubric' | 'gallery';

// Definición de las pestañas del menú superior.
const TABS: { id: ReviewTab; label: string }[] = [
  { id: 'report', label: 'Ver Reporte' },
  { id: 'rubric', label: 'Ver Rúbrica' },
  { id: 'gallery', label: 'Galería de Videos' },
];

interface SessionReviewProps {
  session: SessionData | null; // Datos de la sesión capturados en el Paso 1 (SessionSetup)
  onNewSession: () => void;    // Callback para volver al inicio del flujo
}

export function SessionReview({ session, onNewSession }: SessionReviewProps) {
  // Pestaña activa: cambiar este estado re-renderiza solo la vista inferior.
  const [activeTab, setActiveTab] = useState<ReviewTab>('report');

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      {/* Barra superior: contexto de la sesión + navegación por pestañas.
          El contexto (candidato, ID, tecnología) permanece fijo sin importar
          la pestaña activa — requisito del criterio de aceptación de US11. */}
      <div className="overflow-hidden rounded-2xl border border-[rgba(194,220,213,0.12)] bg-[#11191e] shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 pb-3 pt-5">
          <div>
            <span className="eyebrow">Auditoría de Sesión</span>
            <h2 className="text-xl font-bold text-white font-manrope">
              Evaluación: {session?.candidateName || 'Candidato'}
            </h2>
            <div className="session-label">
              <span className="session-dot" />
              <span>
                {session?.sessionId || 'SES-000000'} · {session?.technology} ·{' '}
                {session?.complexity} · Evaluador: {session?.evaluatorName || '—'}
              </span>
            </div>
            {/* Aviso temporal: quitar cuando las vistas consuman datos reales */}
            <p className="mt-2 text-[10px] text-[#5b6b68]">
              * Los datos mostrados en esta sección son de muestra, pendientes de conexión con el backend.
            </p>
          </div>
          <button
            onClick={onNewSession}
            className="cursor-pointer rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs font-bold text-[#e9f0ed] transition-all hover:border-[#9ce4c1]/40 hover:text-[#9ce4c1]"
          >
            Iniciar nueva sesión
          </button>
        </div>

        {/* Menú de navegación. Cada botón actualiza `activeTab` — el cambio de
            vista es inmediato porque todo vive en el cliente (sin fetch ni reload). */}
        <nav
          role="tablist"
          aria-label="Vistas de auditoría"
          className="flex gap-1 border-t border-[rgba(194,220,213,0.08)] px-3"
        >
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={`relative cursor-pointer px-4 py-3 text-sm font-semibold transition-colors duration-150 ${
                  isActive ? 'text-[#9ce4c1]' : 'text-[#82918f] hover:text-[#e9f0ed]'
                }`}
              >
                {tab.label}
                {/* Indicador inferior de la pestaña activa */}
                <span
                  className={`absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-[#9ce4c1] transition-opacity duration-150 ${
                    isActive ? 'opacity-100 shadow-[0_0_8px_#9ce4c1]' : 'opacity-0'
                  }`}
                />
              </button>
            );
          })}
        </nav>
      </div>

      {/* Vista activa. `key={activeTab}` fuerza el re-montaje para re-disparar
          la animación .tab-panel (definida en globals.css) en cada cambio. */}
      <div key={activeTab} className="tab-panel">
        {activeTab === 'report' && <ReportView session={session} />}
        {activeTab === 'rubric' && <RubricView session={session} />}
        {activeTab === 'gallery' && <VideoGallery session={session} />}
      </div>
    </div>
  );
}
