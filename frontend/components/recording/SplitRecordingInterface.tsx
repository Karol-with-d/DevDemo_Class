'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { SessionData } from '../session/SessionForm';
import { DynamicTimer } from './DynamicTimer';
import { TranscriptSaveResult, useLiveTranscript } from './useLiveTranscript';

const CameraComponent = dynamic(() => import('../../app/CameraComponent'), {
  ssr: false,
  loading: () => (
    <div className="p-6 text-white">Cargando análisis de postura...</div>
  ),
});

interface SplitRecordingInterfaceProps {
  stream: MediaStream | null;
  session: SessionData;
  audioContext?: AudioContext | null;
  onStopRecording?: (transcript: TranscriptSaveResult) => void;
}

export function SplitRecordingInterface({
  stream,
  session,
  audioContext,
  onStopRecording,
}: SplitRecordingInterfaceProps) {
  const [isRecording, setIsRecording] = useState<boolean>(true);
  const [stopping, setStopping] = useState(false);
  const live = useLiveTranscript(stream, session, audioContext);

  const handleStopRecording = async () => {
    if (stopping) return;
    setStopping(true);
    setIsRecording(false);
    const saved = await live.finish();
    stream?.getTracks().forEach((track) => track.stop());
    onStopRecording?.(saved);
  };

  return (
    <div className="recording-shell w-full max-w-6xl mx-auto flex flex-col gap-4">
      <div className="recording-header flex items-center justify-between gap-3 bg-[#11191e] p-5 rounded-2xl border border-[rgba(194,220,213,0.12)] shadow-xl">
        <div className="min-w-0">
          <span className="eyebrow">Paso 3 de 3 · Monitoreo en Vivo</span>
          <h2 className="text-xl font-bold text-white font-manrope">
            Evaluación: {session.candidateName || 'Candidato'}
          </h2>
          <p className="recording-subtitle text-xs text-[#82918f] mt-1">
            Grabación con subtítulos de lo que dice el candidato
          </p>
        </div>
        <DynamicTimer isRecording={isRecording} maxTimeSeconds={900} />
      </div>

      <CameraComponent
        stream={stream}
        embedded
        caption={live.caption}
        previousCaption={live.previousCaption}
        captionStatus={stopping ? 'saving' : live.status}
      />

      <div className="recording-actions flex justify-end mt-2">
        <button
          onClick={handleStopRecording}
          disabled={!isRecording || stopping}
          className="stop-button"
        >
          <span className="stop-icon"></span>
          {stopping ? 'Guardando subtítulos...' : 'Detener Grabación y Finalizar'}
        </button>
      </div>
    </div>
  );
}
