"use client";

import { useEffect, useState } from "react";
import { SavedRecording, deleteCandidateFolder, listRecordings } from "../../lib/api";
import { DeleteCandidateDialog } from "./DeleteCandidateDialog";

interface EvaluationsOverviewProps {
  onBack: () => void;
  onSelectCandidate: (recordings: SavedRecording[]) => void;
}

interface CandidateGroup {
  candidateName: string;
  recordings: SavedRecording[];
}

function groupByCandidate(recordings: SavedRecording[]): CandidateGroup[] {
  const groups = new Map<string, SavedRecording[]>();
  for (const rec of recordings) {
    const key = (rec.candidateName || "Candidato").trim().toLowerCase();
    const list = groups.get(key) ?? [];
    list.push(rec);
    groups.set(key, list);
  }
  return [...groups.values()]
    .map((recs) => ({
      candidateName: recs[0].candidateName || "Candidato",
      recordings: [...recs].sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || "")),
    }))
    .sort(
      (a, b) =>
        (b.recordings[0].savedAt || "").localeCompare(a.recordings[0].savedAt || ""),
    );
}

function formatDate(iso: string): string {
  if (!iso) return "Sin fecha";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("es", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function EvaluationsOverview({ onBack, onSelectCandidate }: EvaluationsOverviewProps) {
  const [items, setItems] = useState<SavedRecording[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<CandidateGroup | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    listRecordings()
      .then((recordings) => {
        setItems(recordings);
        setError(null);
      })
      .catch(() => {
        setError("No se pudo cargar el historial. ¿El backend está en el puerto 8000?");
      })
      .finally(() => setLoading(false));
  }, []);

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteCandidateFolder(pendingDelete.candidateName);
      const removedKey = pendingDelete.candidateName.trim().toLowerCase();
      setItems((current) =>
        current.filter((item) => (item.candidateName || "Candidato").trim().toLowerCase() !== removedKey),
      );
      setNotice(`Se eliminó la carpeta de ${pendingDelete.candidateName}.`);
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "No se pudo eliminar la carpeta.");
    } finally {
      setDeleting(false);
    }
  };

  const groups = groupByCandidate(items);

  return (
    <div className="w-full max-w-6xl rounded-3xl border border-white/10 bg-[#11191e] p-6 text-[#e9f0ed] shadow-2xl sm:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="eyebrow">Historial</span>
          <h2 className="text-2xl font-bold">Evaluaciones anteriores</h2>
          <p className="mt-1 text-sm text-[#82918f]">
            Elige un evaluado para revisar su reporte, su rúbrica y sus grabaciones.
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
      {notice && <p className="mb-4 text-sm text-[#9ce4c1]">{notice}</p>}

      {!error && !loading && groups.length === 0 && (
        <p className="text-sm text-[#82918f]">
          Aún no hay evaluaciones guardadas en el sistema. Graba una sesión para verla aquí.
        </p>
      )}

      {groups.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => {
            const latest = group.recordings[0];
            return (
              <div
                key={group.candidateName}
                className="group flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left transition hover:border-[#9ce4c1]/50 hover:bg-[#9ce4c1]/5"
              >
                <button
                  type="button"
                  onClick={() => onSelectCandidate(group.recordings)}
                  className="flex cursor-pointer flex-col gap-3 text-left"
                >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#9ce4c1]/10 text-lg text-[#9ce4c1]">
                    <svg
                      className="h-5 w-5"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    >
                      <path
                        d="M3 5.5A1.5 1.5 0 014.5 4h3L9.5 6h6A1.5 1.5 0 0117 7.5v7A1.5 1.5 0 0115.5 16h-11A1.5 1.5 0 013 14.5v-9z"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                  <span className="rounded-full bg-[#0d1519] px-3 py-1 text-[11px] font-semibold text-[#82918f]">
                    {group.recordings.length}{" "}
                    {group.recordings.length === 1 ? "grabación" : "grabaciones"}
                  </span>
                </div>

                <div>
                  <p className="text-base font-bold text-white group-hover:text-[#9ce4c1]">
                    {group.candidateName}
                  </p>
                  <p className="mt-0.5 text-xs text-[#82918f]">
                    Evaluador: {latest.evaluatorName || "—"}
                  </p>
                </div>

                <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/[0.07] pt-3 text-[11px] text-[#5b6b68]">
                  <span>
                    {latest.technology || "Sin tecnología"} · {latest.complexity || "—"}
                  </span>
                  <span>Última: {formatDate(latest.savedAt)}</span>
                </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDeleteError(null);
                    setPendingDelete(group);
                  }}
                  className="rounded-xl border border-red-400/35 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-950/40"
                >
                  Eliminar carpeta
                </button>
              </div>
            );
          })}
        </div>
      )}

      {pendingDelete && (
        <DeleteCandidateDialog
          candidateName={pendingDelete.candidateName}
          recordingCount={pendingDelete.recordings.length}
          busy={deleting}
          error={deleteError}
          onCancel={() => {
            if (!deleting) {
              setPendingDelete(null);
              setDeleteError(null);
            }
          }}
          onConfirm={() => void handleConfirmDelete()}
        />
      )}
    </div>
  );
}
