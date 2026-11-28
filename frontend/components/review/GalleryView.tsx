"use client";

// ============================================================================
// US11 · Vista "Galería de Videos" / "Grabaciones"
// Lista las grabaciones y permite reproducirlas con su transcripción técnica.
//
// Dos modos:
//  - Sin props: hace fetch propio con listRecordings() (flujo post-grabación).
//  - Controlado (items/selectedId/onSelect/onDelete): lo usa SessionReview en
//    modo historial para mostrar solo las grabaciones del candidato elegido.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { TechnicalTranscript } from "../recording/TechnicalTranscript";
import {
  SavedRecording,
  deleteRecording,
  listRecordings,
  playbackUrlForKey,
} from "../../lib/api";

interface GalleryViewProps {
  items?: SavedRecording[];
  selectedId?: string | null;
  onSelect?: (rec: SavedRecording) => void;
  onDelete?: (sessionId: string) => Promise<void>;
}

const formatClock = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

export function GalleryView({ items, selectedId, onSelect, onDelete }: GalleryViewProps) {
  const controlled = items !== undefined;
  const [fetched, setFetched] = useState<SavedRecording[]>([]);
  const [internalSelected, setInternalSelected] = useState<SavedRecording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);

  const list = controlled ? items : fetched;
  const selected = controlled
    ? (list.find((r) => r.sessionId === selectedId) ?? list[0] ?? null)
    : internalSelected;

  const refresh = () => {
    listRecordings()
      .then((recordings) => {
        setFetched(recordings);
        setInternalSelected((current) => {
          if (!current) return recordings[0] ?? null;
          return (
            recordings.find((item) => item.sessionId === current.sessionId) ??
            recordings[0] ??
            null
          );
        });
        setError(null);
      })
      .catch(() => {
        setError("No se pudo cargar el historial. ¿El backend está en el puerto 8000?");
      });
  };

  useEffect(() => {
    if (!controlled) refresh();
  }, [controlled]);

  useEffect(() => {
    setCurrentTime(0);
    setVideoDuration(null);
  }, [selected?.sessionId]);

  // Los WebM de MediaRecorder no llevan duración en el header: el navegador
  // reporta Infinity hasta que el video termina. Seek al "infinito" fuerza
  // al navegador a calcular la duración real; luego se regresa a 0.
  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    if (Number.isFinite(video.duration)) {
      setVideoDuration(video.duration);
      return;
    }
    const onDurationChange = () => {
      if (Number.isFinite(video.duration)) {
        video.removeEventListener("durationchange", onDurationChange);
        video.currentTime = 0;
        setVideoDuration(video.duration);
      }
    };
    video.addEventListener("durationchange", onDurationChange);
    video.currentTime = 1e101;
  };

  const handleSeek = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = seconds;
    void video.play();
  };

  const lastSegmentEnd =
    selected?.segments?.reduce((max, seg) => Math.max(max, seg.end ?? seg.start), 0) ?? 0;
  const displayDuration = videoDuration ?? (lastSegmentEnd > 0 ? lastSegmentEnd : null);

  const handleSelect = (rec: SavedRecording) => {
    if (onSelect) onSelect(rec);
    else setInternalSelected(rec);
  };

  const handleDelete = async (rec: SavedRecording) => {
    if (
      !window.confirm(
        `¿Eliminar la grabación de ${rec.candidateName}?`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (onDelete) {
        await onDelete(rec.sessionId);
      } else {
        await deleteRecording(rec.sessionId);
        refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar.");
      if (!controlled) refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-[rgba(194,220,213,0.12)] bg-[#11191e] p-6 shadow-xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(194,220,213,0.1)] pb-4">
        <div>
          <span className="eyebrow">{controlled ? "Grabaciones" : "Galería de Videos"}</span>
          <h3 className="font-manrope text-lg font-bold text-white">Grabaciones guardadas</h3>
        </div>
        <span className="rounded-full bg-[#0d1519] px-3 py-1.5 text-xs font-semibold text-[#82918f]">
          {list.length} {list.length === 1 ? "grabación" : "grabaciones"}
        </span>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {!error && list.length === 0 && (
        <p className="text-sm text-[#82918f]">
          Aún no hay grabaciones guardadas en el sistema.
        </p>
      )}

      {list.length > 0 && (
        <div className="grid gap-5 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
          {/* Lista de sesiones grabadas */}
          <ul className="flex max-h-[26rem] flex-col gap-2 overflow-y-auto">
            {list.map((item) => (
              <li key={item.sessionId}>
                <button
                  type="button"
                  onClick={() => handleSelect(item)}
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
                {selected.evaluatorName} · {selected.complexity}
              </p>
              {selected.videoKey ? (
                <div className="relative mb-4">
                  <video
                    ref={videoRef}
                    key={selected.videoKey}
                    className="aspect-video w-full rounded-xl bg-black"
                    src={playbackUrlForKey(selected.videoKey)}
                    controls
                    playsInline
                    onLoadedMetadata={handleLoadedMetadata}
                    onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                    onDurationChange={(e) => {
                      if (Number.isFinite(e.currentTarget.duration)) {
                        setVideoDuration(e.currentTarget.duration);
                      }
                    }}
                  />
                  <div className="pointer-events-none absolute right-3 top-3 rounded-md bg-black/70 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-white">
                    {formatClock(currentTime)} /{" "}
                    {displayDuration != null ? formatClock(displayDuration) : "--:--"}
                  </div>
                </div>
              ) : (
                <p className="mb-4 text-sm text-[#82918f]">Esta sesión no tiene video guardado.</p>
              )}
              <TechnicalTranscript
                segments={selected.segments ?? []}
                vocabulary={selected.vocabulary ?? []}
                muletillas={selected.muletillas}
                currentTime={selected.videoKey ? currentTime : undefined}
                onSeek={selected.videoKey ? handleSeek : undefined}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {selected.videoKey && (
                  <a
                    className="inline-block rounded-xl bg-[#9ce4c1] px-4 py-2 text-sm font-bold text-[#0b1014]"
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
