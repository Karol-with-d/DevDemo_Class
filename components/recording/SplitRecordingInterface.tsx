'use client';

import { useState } from 'react';
import { LiveCameraStream } from './LiveCameraStream';
import { FeedbackPanel } from './FeedbackPanel';
import { DynamicTimer } from './DynamicTimer';

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
    if (onStopRecording) {
      onStopRecording();
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto p-4 flex flex-col gap-4">
      {/* Cabecera con título, nombre del candidato y Temporizador */}
      <div className="flex items-center justify-between bg-[#11191e] p-5 rounded-2xl border border-[rgba(194,220,213,0.12)] shadow-xl">
        <div>
          <span className="eyebrow">Monitoreo en Vivo</span>
          <h2 className="text-xl font-bold text-white font-manrope">
            Evaluación: {candidateName || 'Candidato'}
          </h2>
          <p className="text-xs text-[#82918f] mt-1">Grabación y análisis de métricas en tiempo real</p>
        </div>
        <DynamicTimer isRecording={isRecording} maxTimeSeconds={900} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-[520px]">
        <div className="md:col-span-2 h-full">
          <LiveCameraStream stream={stream} />
        </div>
        <div className="md:col-span-1 h-full">
          <FeedbackPanel isRecording={isRecording} />
        </div>
      </div>

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