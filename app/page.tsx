'use client';
import { useState } from 'react';
import { SessionSetup, SessionData } from '../components/session/SessionForm';
import { DeviceCalibration } from '../components/calibration/DeviceCalibration';
import { SplitRecordingInterface } from '../components/recording/SplitRecordingInterface';
import { SessionReview } from '../components/review/SessionReview';

export default function Home() {
  const [step, setStep] = useState<'setup' | 'calibration' | 'recording' | 'finished' | 'review'>('setup');
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
    <main className="flex min-h-screen w-full flex-col items-center justify-center p-6 text-[#e9f0ed] md:p-10">
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

      {/* Finalizado */}
      {step === 'finished' && (
        <div className="flex w-full max-w-md flex-col items-center rounded-3xl border border-white/10 bg-[#11191e] p-10 text-center shadow-2xl">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[#9ce4c1]/10 text-2xl text-[#9ce4c1] shadow-[0_0_20px_rgba(156,228,193,0.2)]">
            ✓
          </div>
          <h2 className="mb-2 text-2xl font-bold">Grabación finalizada</h2>
          <p className="mb-8 text-sm text-[#82918f]">
            La sesión del candidato {sessionData?.candidateName} se ha guardado correctamente.
          </p>
          <button
            onClick={() => setStep('review')}
            className="w-full cursor-pointer rounded-xl bg-[#9ce4c1] py-3.5 text-sm font-bold text-[#0b1014] shadow-lg transition-all hover:bg-[#b1f0d2]"
          >
            Auditar evaluación
          </button>
          <button
            onClick={() => setStep('setup')}
            className="mt-3 w-full cursor-pointer rounded-xl border border-white/10 bg-white/[0.03] py-3.5 text-sm font-bold text-[#e9f0ed] transition-all hover:border-[#9ce4c1]/40 hover:text-[#9ce4c1]"
          >
            Iniciar nueva sesión
          </button>
        </div>
      )}

      {/* Auditoría (US11): Reporte / Rúbrica / Galería.
          Se accede desde la pantalla "Grabación finalizada" con el botón
          "Auditar evaluación". Las vistas internas muestran datos de muestra
          hasta conectar con el backend de reportes/grabaciones. */}
      {step === 'review' && (
        <div className="w-full">
          <SessionReview session={sessionData} onNewSession={() => setStep('setup')} />
        </div>
      )}
    </main>
  );
}