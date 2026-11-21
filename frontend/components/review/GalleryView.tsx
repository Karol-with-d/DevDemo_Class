"use client";

// ============================================================================
// US11 · Vista "Galería de Videos"
// Lista las grabaciones reales del sistema y permite reproducirlas con su
// transcripción técnica.
//
// Datos REALES: consume listRecordings() del backend (puerto 8000).
// Es una versión embebida de RecordingsLibrary adaptada a la pestaña:
// sin encabezado propio ni botón "Volver" (eso ya lo da la barra de US11).
// ============================================================================

import { useEffect, useState } from "react";
import { TechnicalTranscript } from "../recording/TechnicalTranscript";
import { SavedRecording, listRecordings, playbackUrlForKey } from "../../lib/api";

export function GalleryView() {
  const [items, setItems] = useState<SavedRecording[]>([]);
  const [selected, setSelected] = useState<SavedRecording | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listRecordings()
      .then((recordings) => {
        setItems(recordings);
        setSelected(recordings[0] ?? null);
        setError(null);
      })
      .catch(() => {
        setError("No se pudo cargar el historial. ¿El backend está en el puerto 8000?");
      });
  }, []);

  return (
    <div className="rounded-2xl border border-[rgba(194,220,213,0.12)] bg-[#11191e] p-6 shadow-xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(194,220,213,0.1)] pb-4">
        <div>
          <span className="eyebrow">Galería de Videos</span>
          <h3 className="font-manrope text-lg font-bold text-white">Grabaciones guardadas</h3>
        </div>
        <span className="rounded-full bg-[#0d1519] px-3 py-1.5 text-xs font-semibold text-[#82918f]">
          {items.length} {items.length === 1 ? "grabación" : "grabaciones"}
        </span>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {!error && items.length === 0 && (
        <p className="text-sm text-[#82918f]">
          Aún no hay grabaciones guardadas en el sistema.
        </p>
      )}

      {items.length > 0 && (
        <div className="grid gap-5 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
          {/* Lista de sesiones grabadas */}
          <ul className="flex max-h-[26rem] flex-col gap-2 overflow-y-auto">
            {items.map((item) => (
              <li key={item.sessionId}>
                <button
                  type="button"
                  onClick={() => setSelected(item)}
                  className={`w-full cursor-pointer rounded-2xl border px-4 py-3 text-left text-sm transition ${
                    selected?.sessionId === item.sessionId
                      ? "border-[#9ce4c1]/60 bg-[#9ce4c1]/10"
                      : "border-white/10 bg-white/[0.03] hover:border-white/20"
                  }`}
                >
                  <p className="font-semibold">{item.candidateName}</p>
                  <p className="text-xs text-[#82918f]">
                    {item.sessionId} · {item.technology || "Sin tecnología"}
                  </p>
                </button>
              </li>
            ))}
          </ul>

          {/* Reproductor + transcripción de la sesión seleccionada */}
          {selected && (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <h4 className="mb-1 text-lg font-bold">{selected.candidateName}</h4>
              <p className="mb-4 text-xs text-[#82918f]">
                {selected.evaluatorName} · {selected.complexity} · {selected.segmentCount} subtítulos
              </p>
              {selected.videoKey ? (
                <video
                  key={selected.videoKey}
                  className="mb-4 aspect-video w-full rounded-xl bg-black"
                  src={playbackUrlForKey(selected.videoKey)}
                  controls
                  playsInline
                />
              ) : (
                <p className="mb-4 text-sm text-[#82918f]">Esta sesión no tiene video en S3.</p>
              )}
              <TechnicalTranscript
                segments={selected.segments ?? []}
                vocabulary={selected.vocabulary ?? []}
              />
              {selected.videoKey && (
                <a
                  className="mt-2 inline-block rounded-xl bg-[#9ce4c1] px-4 py-2 text-sm font-bold text-[#0b1014]"
                  href={playbackUrlForKey(selected.videoKey, true)}
                >
                  Guardar en dispositivo
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
