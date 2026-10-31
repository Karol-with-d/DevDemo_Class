'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { DynamicTimer } from './DynamicTimer';

const CameraComponent = dynamic(() => import('../../app/CameraComponent'), {
  ssr: false,
  loading: () => (
    <div className="p-6 text-white">Cargando análisis de postura...</div>
  ),
});

interface SplitRecordingInterfaceProps {
  stream: MediaStream | null;
  candidateName?: string;
  onStopRecording?: () => void;
}

export function SplitRecordingInterface({
  stream,
  candidateName,
  onStopRecording,
}: SplitRecordingInterfaceProps) {
  const [isRecording, setIsRecording] = useState<boolean>(true);

  const handleStopRecording = () => {
    setIsRecording(false);
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    onStopRecording?.();
  };

  return (
    <div className="recording-shell w-full max-w-6xl mx-auto flex flex-col gap-4">
      <div className="flex items-center justify-between bg-[#11191e] p-5 rounded-2xl border border-[rgba(194,220,213,0.12)] shadow-xl">
        <div>
          <span className="eyebrow">Paso 3 de 3 · Monitoreo en Vivo</span>
          <h2 className="text-xl font-bold text-white font-manrope">
            Evaluación: {candidateName || 'Candidato'}
          </h2>
          <p className="text-xs text-[#82918f] mt-1">Grabación y análisis de postura en tiempo real</p>
        </div>
        <DynamicTimer isRecording={isRecording} maxTimeSeconds={900} />
      </div>

      <CameraComponent stream={stream} embedded />

      <div className="flex justify-end mt-2">
        <button
          onClick={handleStopRecording}
          disabled={!isRecording}
          className="stop-button"
        >
          <span className="stop-icon"></span>
          Detener Grabación y Finalizar
        </button>
      </div>
    </div>
  );
}
