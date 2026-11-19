'use client';

import React, { useEffect, useState } from 'react';

export interface SavedRecording {
  sessionId: string;
  candidateName?: string;
  evaluatorName?: string;
  technology?: string;
  complexity?: string;
  videoKey?: string;
  createdAt?: string;
}

interface Props {
  onSelectForEvaluation: (recording: SavedRecording) => void;
}

export const SavedRecordingsView: React.FC<Props> = ({ onSelectForEvaluation }) => {
  const [recordings, setRecordings] = useState<SavedRecording[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVideoKey, setSelectedVideoKey] = useState<string | null>(null);

  const fetchRecordings = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('http://127.0.0.1:8000/recordings');
      if (!res.ok) throw new Error('No se pudo conectar con el servidor Python.');
      const data = await res.json();
      setRecordings(data.recordings || []);
    } catch (err: any) {
      setError(err.message || 'Error al cargar las grabaciones guardadas.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecordings();
  }, []);

  return (
    <div className="w-full max-w-4xl rounded-3xl border border-white/10 bg-[#11191e]/90 p-8 shadow-2xl backdrop-blur-md">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <h2 className="text-2xl font-bold text-[#e9f0ed]">Sesiones y Videos Guardados</h2>
          <p className="text-sm text-[#82918f]">
            Consulta las grabaciones almacenadas en AWS S3 y abre su rúbrica evaluativa.
          </p>
        </div>
        <button
          onClick={fetchRecordings}
          className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-[#e9f0ed] transition-colors hover:bg-white/10"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Actualizar lista
        </button>
      </div>

      {selectedVideoKey && (
        <div className="mb-6 rounded-2xl border border-[#9ce4c1]/30 bg-[#0b1014] p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-[#9ce4c1]">Reproduciendo desde AWS S3</span>
            <button
              onClick={() => setSelectedVideoKey(null)}
              className="cursor-pointer text-xs text-[#82918f] hover:text-white"
            >
              Cerrar video ✕
            </button>
          </div>
          <video
            src={`http://127.0.0.1:8000/video?key=${encodeURIComponent(selectedVideoKey)}`}
            controls
            autoPlay
            className="max-h-80 w-full rounded-xl bg-black"
          />
        </div>
      )}

      {loading && (
        <p className="py-10 text-center text-sm text-[#82918f]">Cargando información de candidatos...</p>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-center text-sm text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && recordings.length === 0 && (
        <div className="rounded-2xl border border-white/5 bg-[#0b1014]/60 p-10 text-center">
          <p className="text-sm text-[#82918f]">Aún no hay videos o sesiones guardadas en el sistema.</p>
        </div>
      )}

      {!loading && !error && recordings.length > 0 && (
        <div className="space-y-3">
          {recordings.map((rec) => (
            <div
              key={rec.sessionId}
              className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[#0b1014]/80 p-4 transition-colors hover:border-[#9ce4c1]/30"
            >
              <div>
                <h3 className="font-semibold text-[#e9f0ed]">
                  {rec.candidateName || `Sesión ${rec.sessionId}`}
                </h3>
                <p className="text-xs text-[#82918f]">
                  {rec.technology ? `Tecnología: ${rec.technology}` : 'Sin tecnología'} •{' '}
                  {rec.complexity ? `Nivel: ${rec.complexity}` : 'Nivel estándar'} • ID: {rec.sessionId}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {rec.videoKey && (
                  <button
                    onClick={() => setSelectedVideoKey(rec.videoKey!)}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-medium text-[#e9f0ed] transition-colors hover:bg-white/10"
                  >
                    <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    Ver Video
                  </button>
                )}

                <button
                  onClick={() => onSelectForEvaluation(rec)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[#9ce4c1] px-4 py-2 text-xs font-bold text-[#0b1014] transition-colors hover:bg-[#b1f0d2]"
                >
                  Evaluar / Ver Rúbrica
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};