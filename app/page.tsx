'use client';
import { useState } from 'react';
import { SessionSetup, SessionData } from '../components/session/SessionForm';
import { DeviceCalibration } from '../components/calibration/DeviceCalibration';
import { SplitRecordingInterface } from '../components/recording/SplitRecordingInterface';
import { ConsolidatedReportView } from '../components/reports/ConsolidatedReportView';

export default function Home() {
  const [step, setStep] = useState<'setup' | 'calibration' | 'recording' | 'finished' | 'evaluation'>('setup');
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

  const handleSessionReady = (data: SessionData) => {
    setSessionData(data);
    setStep('calibration');
  };

  const handleCalibrationComplete = (stream: MediaStream) => {
    setMediaStream(stream);
    setStep('recording');
  };

  return (
    <main className="relative flex min-h-screen w-full flex-col items-center justify-center p-6 text-[#e9f0ed] md:p-10">
      {/* Acceso rápido superior para alternar entre el flujo inicial y el Panel Evaluador (US9 & US10) */}
      <div className="fixed top-4 right-4 z-50 flex gap-2">
        {step !== 'evaluation' ? (
          <button
            onClick={() => setStep('evaluation')}
            className="cursor-pointer rounded-full border border-[#9ce4c1]/30 bg-[#11191e]/90 px-4 py-1.5 text-xs font-medium text-[#9ce4c1] shadow-lg backdrop-blur-md transition-all hover:bg-[#9ce4c1]/10"
          >
            Ver Panel Evaluador (US9 & US10) →
          </button>
        ) : (
          <button
            onClick={() => setStep('setup')}
            className="cursor-pointer rounded-full border border-white/15 bg-[#11191e]/90 px-4 py-1.5 text-xs font-medium text-[#e9f0ed] shadow-lg backdrop-blur-md transition-all hover:bg-white/10"
          >
            ← Volver al Inicio
          </button>
        )}
      </div>

      {/* Paso 1: Configuración */}
      {step === 'setup' && (
        <div className="w-full max-w-xl">
          <SessionSetup onSessionReady={handleSessionReady} />
        </div>
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

      {/* Paso 4: Finalizado (Punto de enlace hacia AWS S3 y la Rúbrica) */}
      {step === 'finished' && (
        <div className="flex w-full max-w-md flex-col items-center rounded-3xl border border-white/10 bg-[#11191e] p-10 text-center shadow-2xl">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[#9ce4c1]/10 text-2xl text-[#9ce4c1] shadow-[0_0_20px_rgba(156,228,193,0.2)]">
            ✓
          </div>
          <h2 className="mb-2 text-2xl font-bold">Grabación finalizada</h2>
          <p className="mb-8 text-sm text-[#82918f]">
            La sesión del candidato <span className="font-semibold text-[#e9f0ed]">{sessionData?.candidateName || 'registrado'}</span> se ha guardado correctamente.
          </p>

          <div className="flex w-full flex-col gap-3">
            {/* Botón principal para abrir tu Rúbrica US9 + Reporte US10 */}
            <button
              onClick={() => setStep('evaluation')}
              className="w-full cursor-pointer rounded-xl bg-[#9ce4c1] py-3.5 text-sm font-bold text-[#0b1014] shadow-lg transition-all hover:bg-[#b1f0d2]"
            >
              Continuar a Rúbrica y Reporte (US9 & US10)
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

      {/* Paso 5: Rúbrica Híbrida y Reporte Consolidado (US9 & US10) */}
      {step === 'evaluation' && (
        <div className="w-full max-w-5xl pt-6">
          <ConsolidatedReportView />
        </div>
      )}
    </main>
  );
}