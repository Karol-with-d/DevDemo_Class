"use client";

import { useEffect, useState } from "react";
import { TechnicalTranscript } from "../recording/TechnicalTranscript";
import {
  SavedRecording,
  deleteRecording,
  listRecordings,
  playbackUrlForKey,
} from "../../lib/api";

interface RecordingsLibraryProps {
  onBack: () => void;
}

export function RecordingsLibrary({ onBack }: RecordingsLibraryProps) {
  const [items, setItems] = useState<SavedRecording[]>([]);
  const [selected, setSelected] = useState<SavedRecording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const recordings = await listRecordings();
      setItems(recordings);
      setSelected((current) => {
        if (!current) return recordings[0] ?? null;
        return recordings.find((item) => item.sessionId === current.sessionId) ?? recordings[0] ?? null;
      });
      setError(null);
    } catch {
      setError("No se pudo cargar el historial. ¿El backend está en el puerto 8000?");
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const removeFromList = (sessionId: string) => {
    setItems((current) => {
      const next = current.filter((item) => item.sessionId !== sessionId);
      setSelected((selectedItem) => {
        if (selectedItem?.sessionId !== sessionId) return selectedItem;
        return next[0] ?? null;
      });
      return next;
    });
  };

  const handleDelete = async (recording: SavedRecording) => {
    if (!window.confirm(`¿Eliminar la grabación de ${recording.candidateName}? Se borra del sistema y de S3.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteRecording(recording.sessionId);
      removeFromList(recording.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar.");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-5xl rounded-3xl border border-white/10 bg-[#11191e] p-6 text-[#e9f0ed] shadow-2xl sm:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="eyebrow">Biblioteca</span>
          <h2 className="text-2xl font-bold">Grabaciones guardadas</h2>
          <p className="mt-1 text-sm text-[#82918f]">
            Videos que quedaron en el sistema. Puedes reproducirlos, bajarlos al dispositivo o eliminarlos sin entrar a AWS.
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-[#e9f0ed] hover:border-white/30"
        >
          Volver al inicio
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {items.length === 0 ? (
        <p className="text-sm text-[#82918f]">Aún no hay grabaciones guardadas en el sistema.</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
          <ul className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto">
            {items.map((item) => (
              <li key={item.sessionId}>
                <button
                  type="button"
                  onClick={() => setSelected(item)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition ${
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

          {selected && (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <h3 className="mb-1 text-lg font-bold">{selected.candidateName}</h3>
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
              <div className="flex flex-wrap gap-2">
                {selected.videoKey && (
                  <a
                    className="rounded-xl bg-[#9ce4c1] px-4 py-2 text-sm font-bold text-[#0b1014]"
                    href={playbackUrlForKey(selected.videoKey, true)}
                  >
                    Guardar en dispositivo
                  </a>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleDelete(selected)}
                  className="rounded-xl border border-red-400/40 px-4 py-2 text-sm font-semibold text-red-300 hover:bg-red-950/40 disabled:opacity-50"
                >
                  Eliminar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
