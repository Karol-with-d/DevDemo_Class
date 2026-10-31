'use client';

import { useState, useEffect } from 'react';
import { CameraPreview } from './CameraPreview';
import { AudioLevelIndicator } from './AudioLevelIndicator';

interface DeviceCalibrationProps {
  onCalibrationComplete: (stream: MediaStream) => void;
}

export function DeviceCalibration({ onCalibrationComplete }: DeviceCalibrationProps) {
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Inicializar cámara y micrófono
  useEffect(() => {
    async function setupDevices() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true,
        });
        setMediaStream(stream);
        setError(null);
      } catch (err) {
        console.error('Error al acceder a dispositivos:', err);
        setError('No se pudo acceder a la cámara o al micrófono. Verifica los permisos de tu navegador.');
      }
    }

    setupDevices();

    return () => {
      // Detener los tracks si se desmonta el componente antes de completar
      if (mediaStream && countdown === null) {
        mediaStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // Manejar el conteo regresivo (3, 2, 1) antes de la grabación
  const handleStartRecording = () => {
    if (!mediaStream) return;
    setCountdown(3);
  };

  useEffect(() => {
    if (countdown === null) return;

    if (countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown((prev) => (prev !== null ? prev - 1 : null));
      }, 1000);
      return () => clearTimeout(timer);
    }

    if (countdown === 0 && mediaStream) {
      onCalibrationComplete(mediaStream);
    }
  }, [countdown, mediaStream, onCalibrationComplete]);

  return (
    <div className="calibration-card w-full max-w-2xl mx-auto text-white relative">
      <div className="flex items-center justify-between mb-4 border-b border-[rgba(194,220,213,0.1)] pb-3">
        <div>
          <span className="eyebrow">Paso 2 de 3</span>
          <h2 className="text-xl font-bold font-manrope text-white">Calibración Técnica Previa</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${mediaStream ? 'bg-[#9ce4c1] shadow-[0_0_8px_#9ce4c1]' : 'bg-red-500'}`}></span>
          <span className="text-xs text-[#82918f] font-semibold uppercase tracking-wider">
            {mediaStream ? 'Dispositivos Listos' : 'Conectando...'}
          </span>
        </div>
      </div>

      {error && (
        <div className="p-3.5 mb-4 bg-red-950/60 border border-red-500/40 rounded-xl text-red-200 text-xs flex items-center gap-2">
          <svg className="w-4 h-4 flex-shrink-0 text-red-400" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {/* Visor de Cámara con Conteo Regresivo Superpuesto */}
      <div className="relative overflow-hidden rounded-2xl border border-[rgba(194,220,213,0.12)] bg-[#080c0e] min-h-[300px]">
        <CameraPreview stream={mediaStream} />

        {/* Conteo flotando centrado en la cámara */}
        {countdown !== null && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0b1014]/80 backdrop-blur-md z-30 transition-all">
            <span className="text-7xl font-extrabold text-[#9ce4c1] font-manrope animate-pulse drop-shadow-[0_0_30px_rgba(156,228,193,0.6)]">
              {countdown}
            </span>
            <p className="text-xs text-[#82918f] uppercase tracking-widest mt-3 font-semibold">
              Iniciando la Demo Class...
            </p>
          </div>
        )}
      </div>

      {/* Indicador de Nivel de Audio */}
      <div className="mt-4 bg-[#0d1519] border border-[rgba(194,220,213,0.08)] p-3.5 rounded-xl">
        <AudioLevelIndicator stream={mediaStream} />
      </div>

      {/* Botón de Acción */}
      <button
        onClick={handleStartRecording}
        disabled={!mediaStream || countdown !== null}
        className="w-full mt-5 py-3.5 bg-[#9ce4c1] hover:bg-[#b1e9c9] disabled:bg-[#151f24] disabled:text-[#82918f] disabled:cursor-not-allowed text-[#0b1014] font-bold rounded-xl transition-all shadow-lg text-sm uppercase tracking-wider font-manrope"
      >
        {countdown !== null ? `Iniciando en ${countdown}...` : 'Confirmar y Comenzar Demo'}
      </button>
    </div>
  );
}