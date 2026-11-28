'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { deleteRecording, uploadRecording } from '../../lib/api';
import { SessionData } from '../session/SessionForm';
import { DynamicTimer } from './DynamicTimer';
import { TranscriptSaveResult, useLiveTranscript } from './useLiveTranscript';

function recorderOptions(): MediaRecorderOptions | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const types = [
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm',
    'video/mp4',
  ];
  const mimeType = types.find((type) => MediaRecorder.isTypeSupported(type));
  return mimeType ? { mimeType } : undefined;
}

function audioRecorderOptions(): MediaRecorderOptions | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  const mimeType = types.find((type) => MediaRecorder.isTypeSupported(type));
  return mimeType
    ? { mimeType, audioBitsPerSecond: 64000 }
    : { audioBitsPerSecond: 64000 };
}

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
  onCancel?: () => void;
}

export function SplitRecordingInterface({
  stream,
  session,
  audioContext,
  onStopRecording,
  onCancel,
}: SplitRecordingInterfaceProps) {
  const [isRecording, setIsRecording] = useState<boolean>(true);
  const [stopping, setStopping] = useState(false);
  const [paused, setPaused] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [runId, setRunId] = useState(0);
  const live = useLiveTranscript(stream, session, audioContext);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const activeMsRef = useRef<number>(0);
  const segmentStartRef = useRef<number>(0);

  useEffect(() => {
    if (!stream || typeof MediaRecorder === 'undefined') return;

    chunksRef.current = [];
    audioChunksRef.current = [];
    activeMsRef.current = 0;
    segmentStartRef.current = performance.now();

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, recorderOptions());
    } catch (error) {
      console.error('MediaRecorder no disponible:', error);
      return;
    }

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.start(1000);
    recorderRef.current = recorder;

    // Parallel lightweight audio-only recorder (~480 KB/min Opus) for fast,
    // full-file transcription without video overhead or ffmpeg dependency.
    let audioRecorder: MediaRecorder | null = null;
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length > 0) {
      try {
        audioRecorder = new MediaRecorder(new MediaStream(audioTracks), audioRecorderOptions());
        audioRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) audioChunksRef.current.push(event.data);
        };
        audioRecorder.start(1000);
        audioRecorderRef.current = audioRecorder;
      } catch (error) {
        console.warn('Audio-only MediaRecorder no disponible, se usará el video:', error);
      }
    }

    return () => {
      recorderRef.current = null;
      recorder.ondataavailable = null;
      if (recorder.state !== 'inactive') recorder.stop();
      audioRecorderRef.current = null;
      if (audioRecorder) {
        audioRecorder.ondataavailable = null;
        if (audioRecorder.state !== 'inactive') audioRecorder.stop();
      }
    };
  }, [stream]);

  const stopRecorder = (
    recorder: MediaRecorder | null,
    chunks: Blob[],
    fallbackType: string,
  ) =>
    new Promise<Blob | null>((resolve) => {
      const toBlob = () => {
        const type = recorder?.mimeType || fallbackType;
        const blob = new Blob(chunks, { type });
        resolve(blob.size > 0 ? blob : null);
      };
      if (!recorder || recorder.state === 'inactive') {
        toBlob();
        return;
      }
      recorder.onstop = toBlob;
      recorder.stop();
    });

  const activeElapsedSeconds = () => {
    const running = paused ? 0 : performance.now() - segmentStartRef.current;
    return Math.max(0, (activeMsRef.current + running) / 1000);
  };

  const resumeRecorders = () => {
    try {
      recorderRef.current?.resume();
    } catch {
      /* ya reanudado */
    }
    try {
      audioRecorderRef.current?.resume();
    } catch {
      /* ya reanudado */
    }
  };

  const handlePause = () => {
    if (paused || stopping || !isRecording) return;
    activeMsRef.current += performance.now() - segmentStartRef.current;
    if (recorderRef.current?.state === 'recording') recorderRef.current.pause();
    if (audioRecorderRef.current?.state === 'recording') audioRecorderRef.current.pause();
    live.setPaused(true);
    setPaused(true);
  };

  const handleResume = () => {
    segmentStartRef.current = performance.now();
    resumeRecorders();
    live.setPaused(false);
    setPaused(false);
  };

  const handleRestart = () => {
    chunksRef.current = [];
    audioChunksRef.current = [];
    live.reset();
    activeMsRef.current = 0;
    segmentStartRef.current = performance.now();
    resumeRecorders();
    setRunId((id) => id + 1);
    setPaused(false);
  };

  const handleCancel = async () => {
    if (cancelling) return;
    if (
      !window.confirm(
        '¿Cancelar esta sesión? Se descartará la grabación y los subtítulos.',
      )
    ) {
      return;
    }
    setCancelling(true);
    try {
      if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop();
      if (audioRecorderRef.current?.state !== 'inactive')
        audioRecorderRef.current?.stop();
    } catch {
      /* liberación best-effort */
    }
    live.discard();
    try {
      await deleteRecording(session.sessionId);
    } catch (error) {
      console.error('No se pudo limpiar la sesión cancelada:', error);
    }
    stream?.getTracks().forEach((track) => track.stop());
    onCancel?.();
  };

  const handleFinishFromPause = () => {
    resumeRecorders();
    live.setPaused(false);
    segmentStartRef.current = performance.now();
    setPaused(false);
    void handleStopRecording();
  };

  const handleStopRecording = async () => {
    if (stopping) return;
    setStopping(true);
    setIsRecording(false);
    const durationSeconds = activeElapsedSeconds();
    const [blob, audioBlob] = await Promise.all([
      stopRecorder(recorderRef.current, chunksRef.current, 'video/webm'),
      stopRecorder(audioRecorderRef.current, audioChunksRef.current, 'audio/webm'),
    ]);

    const uploadPromise: Promise<Awaited<ReturnType<typeof uploadRecording>> | undefined> = blob
      ? uploadRecording(blob, session, { audioBlob, durationSeconds }).catch((error) => {
          console.error('No se pudo subir el video:', error);
          return undefined;
        })
      : Promise.resolve(undefined);

    const [saved, video] = await Promise.all([live.finish(), uploadPromise]);
    stream?.getTracks().forEach((track) => track.stop());
    onStopRecording?.({
      ...saved,
      videoUrl: video?.playbackUrl,
      videoKey: video?.key,
      videoStorage: video?.source,
    });
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
        <DynamicTimer key={runId} isRecording={isRecording && !paused} maxTimeSeconds={900} />
      </div>

      <CameraComponent
        stream={stream}
        sessionId={session.sessionId}
        embedded
        caption={live.caption}
        previousCaption={live.previousCaption}
        captionStatus={stopping ? 'saving' : live.status}
      />

      <div className="recording-actions mt-2 flex flex-wrap justify-end gap-3">
        {paused ? (
          <>
            <button
              type="button"
              onClick={() => void handleCancel()}
              disabled={cancelling}
              className="pause-button pause-button-danger"
            >
              {cancelling ? 'Cancelando...' : 'Cancelar'}
            </button>
            <button
              type="button"
              onClick={handleRestart}
              className="pause-button"
            >
              Reiniciar
            </button>
            <button
              type="button"
              onClick={handleResume}
              className="pause-button pause-button-active"
            >
              Continuar
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={handlePause}
            disabled={!isRecording || stopping}
            className="pause-button"
          >
            Pausar
          </button>
        )}
        <button
          onClick={paused ? handleFinishFromPause : handleStopRecording}
          disabled={!isRecording || stopping}
          className="stop-button"
        >
          <span className="stop-icon"></span>
          {stopping ? 'Guardando grabación...' : 'Detener Grabación y Finalizar'}
        </button>
      </div>
    </div>
  );
}
