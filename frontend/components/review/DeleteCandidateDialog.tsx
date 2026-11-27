"use client";

interface DeleteCandidateDialogProps {
  candidateName: string;
  recordingCount: number;
  busy: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteCandidateDialog({
  candidateName,
  recordingCount,
  busy,
  error,
  onCancel,
  onConfirm,
}: DeleteCandidateDialogProps) {
  const countLabel =
    recordingCount === 1 ? "1 grabación" : `${recordingCount} grabaciones`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-candidate-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-red-400/30 bg-[#11191e] p-6 text-[#e9f0ed] shadow-2xl">
        <p className="eyebrow text-red-300">Acción irreversible</p>
        <h3 id="delete-candidate-title" className="mt-1 text-lg font-bold text-white">
          ¿Eliminar la carpeta de {candidateName}?
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-[#c5d0cd]">
          Se borrarán de forma permanente <strong>{countLabel}</strong>, los videos en AWS S3,
          las rúbricas, las evaluaciones y el registro local de este candidato. No se puede
          deshacer.
        </p>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold hover:border-white/30 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="rounded-xl bg-red-500 px-4 py-2 text-sm font-bold text-white hover:bg-red-400 disabled:opacity-50"
          >
            {busy ? "Eliminando…" : "Eliminar carpeta"}
          </button>
        </div>
      </div>
    </div>
  );
}
