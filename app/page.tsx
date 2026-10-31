'use client';
import { useState } from 'react';
import { SessionSetup, SessionData } from '../components/session/SessionForm';
import { DeviceCalibration } from '../components/calibration/DeviceCalibration';
import { SplitRecordingInterface } from '../components/recording/SplitRecordingInterface';

export default function Home() {
  const [step, setStep] = useState<'setup' | 'calibration' | 'recording' | 'finished'>('setup');
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
            onClick={() => setStep('setup')}
            className="w-full cursor-pointer rounded-xl bg-[#9ce4c1] py-3.5 text-sm font-bold text-[#0b1014] shadow-lg transition-all hover:bg-[#b1f0d2]"
          >
            Iniciar nueva sesión
          </button>
        </div>
      )}
    </main>
  );
}