'use client';
import { useState } from 'react';
import { SessionSetup, SessionData } from '../components/session/SessionForm';
import { DeviceCalibration } from '../components/calibration/DeviceCalibration';
import { SplitRecordingInterface } from '../components/recording/SplitRecordingInterface';
import { ConsolidatedReportView } from '../components/reports/ConsolidatedReportView';
import { SavedRecordingsView, SavedRecording } from '../components/recording/SavedRecordingsView';

export default function Home() {
  const [step, setStep] = useState<'setup' | 'saved' | 'calibration' | 'recording' | 'finished' | 'evaluation'>('setup');
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [selectedRecording, setSelectedRecording] = useState<SavedRecording | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

  const handleSessionReady = (data: SessionData) => {
    setSessionData(data);
    setStep('calibration');
  };

  const handleCalibrationComplete = (stream: MediaStream) => {
    setMediaStream(stream);
    setStep('recording');
  };

  const handleOpenSavedEvaluation = (recording: SavedRecording) => {
    setSelectedRecording(recording);
    setStep('evaluation');
  };

  return (
    <main className="relative flex min-h-screen w-full flex-col items-center justify-center p-6 text-[#e9f0ed] md:p-10">
      {/* Selector superior tipo pill */}
      {(step === 'setup' || step === 'saved') && (
        <div className="mb-8 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[#11191e]/80 p-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.4)] backdrop-blur-xl">
          <button
            onClick={() => setStep('setup')}
            className={`inline-flex cursor-pointer items-center gap-2.5 rounded-full px-6 py-2.5 text-sm font-semibold tracking-wide transition-all duration-200 ${
              step === 'setup'
                ? 'bg-[#9ce4c1] text-[#0b1014] shadow-[0_0_20px_rgba(156,228,193,0.3)]'
                : 'text-[#82918f] hover:bg-white/5 hover:text-[#e9f0ed]'
            }`}
          >
            <span className="relative flex h-2.5 w-2.5">
              {step === 'setup' && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0b1014] opacity-40" />
              )}
              <span
                className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                  step === 'setup' ? 'bg-[#0b1014]' : 'bg-[#9ce4c1]'
                }`}
              />
            </span>
            Empezar Demo
          </button>

          <button
            onClick={() => setStep('saved')}
            className={`inline-flex cursor-pointer items-center gap-2.5 rounded-full px-6 py-2.5 text-sm font-semibold tracking-wide transition-all duration-200 ${
              step === 'saved'
                ? 'bg-[#9ce4c1] text-[#0b1014] shadow-[0_0_20px_rgba(156,228,193,0.3)]'
                : 'text-[#82918f] hover:bg-white/5 hover:text-[#e9f0ed]'
            }`}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            Sesiones Guardadas
          </button>
        </div>
      )}

      {/* Botón rápido de regreso cuando estás dentro de la Rúbrica */}
      {step === 'evaluation' && (
        <div className="fixed top-4 right-4 z-50">
          <button
            onClick={() => setStep('saved')}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-white/15 bg-[#11191e]/90 px-4 py-1.5 text-xs font-medium text-[#e9f0ed] shadow-lg backdrop-blur-md transition-all hover:bg-white/10"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Volver a Sesiones Guardadas
          </button>
        </div>
      )}

      {/* Vista A: Empezar Demo (Formulario de Sesión) */}
      {step === 'setup' && (
        <div className="w-full max-w-xl">
          <SessionSetup onSessionReady={handleSessionReady} />
        </div>
      )}

      {/* Vista B: Videos e Información Guardada de los Candidatos */}
      {step === 'saved' && (
        <SavedRecordingsView onSelectForEvaluation={handleOpenSavedEvaluation} />
      )}

      {/* Paso 2: Calibración */}
      {step === 'calibration' && (
        <div className="w-full max-w-4xl rounded-3xl border border-white/10 bg-[#11191e]/90 p-8 shadow-2xl backdrop-blur-md">
          <DeviceCalibration onCalibrationComplete={handleCalibrationComplete} />
        </div>
      )}

      {/* Paso 3: Grabación */}
      {step === 'recording' && mediaStream && (
        <div className="recording-shell">
          <SplitRecordingInterface
            stream={mediaStream}
            candidateName={sessionData?.candidateName}
            onStopRecording={() => setStep('finished')}
          />
        </div>
      )}

      {/* Paso 4: Finalizado */}
      {step === 'finished' && (
        <div className="flex w-full max-w-md flex-col items-center rounded-3xl border border-white/10 bg-[#11191e] p-10 text-center shadow-2xl">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[#9ce4c1]/10 text-2xl text-[#9ce4c1] shadow-[0_0_20px_rgba(156,228,193,0.2)]">
            ✓
          </div>
          <h2 className="mb-2 text-2xl font-bold">Grabación finalizada</h2>
          <p className="mb-8 text-sm text-[#82918f]">
            La sesión del candidato{' '}
            <span className="font-semibold text-[#e9f0ed]">{sessionData?.candidateName || 'registrado'}</span> se ha guardado correctamente.
          </p>

          <div className="flex w-full flex-col gap-3">
            <button
              onClick={() => setStep('evaluation')}
              className="w-full cursor-pointer rounded-xl bg-[#9ce4c1] py-3.5 text-sm font-bold text-[#0b1014] shadow-lg transition-all hover:bg-[#b1f0d2]"
            >
              Continuar a Rúbrica y Reporte
            </button>

            <button
              onClick={() => setStep('setup')}
              className="w-full cursor-pointer rounded-xl border border-white/10 bg-transparent py-3 text-sm font-medium text-[#82918f] transition-all hover:bg-white/5 hover:text-white"
            >
              Iniciar nueva sesión
            </button>
          </div>
        </div>
      )}

      {/* Paso 5: Rúbrica Híbrida y Reporte Consolidado */}
      {step === 'evaluation' && (
        <div className="w-full max-w-5xl pt-6">
          <ConsolidatedReportView />
        </div>
      )}
    </main>
  );
}