'use client';
import { useState, useEffect } from 'react';
import { CameraPreview } from './CameraPreview';
import { AudioLevelIndicator } from './AudioLevelIndicator';

interface DeviceCalibrationProps {
  onCalibrationComplete?: (stream: MediaStream) => void;
}

export const DeviceCalibration = ({ onCalibrationComplete }: DeviceCalibrationProps) => {
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Solicita los permisos de audio y video
  const requestPermissions = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true,
      });
      setMediaStream(stream);
      setError(null);
    } catch (err) {
      console.error(err);
      setError('No se pudo acceder a la cámara o micrófono. Revisa los permisos de tu navegador.');
    }
  };

  useEffect(() => {
    requestPermissions();
  }, []);

  // Inicia la cuenta regresiva al presionar el botón
  const handleStartRecording = () => {
    setCountdown(3);
  };

  // Maneja el temporizador de 3, 2, 1...
  useEffect(() => {
    if (countdown === null) return;

    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else if (countdown === 0) {
      if (onCalibrationComplete && mediaStream) {
        onCalibrationComplete(mediaStream);
      }
    }
  }, [countdown, mediaStream, onCalibrationComplete]);

  return (
    <div className="p-6 max-w-2xl mx-auto bg-gray-900 text-white rounded-xl shadow-lg relative">
      <h2 className="text-xl font-bold mb-4">Épica 1: Calibración Técnica Previa</h2>

      {error && (
        <div className="p-3 mb-4 bg-red-600/30 border border-red-500 rounded text-red-200 text-sm">
          {error}
        </div>
      )}

      {/* Muestra la cámara y la barra de nivel de voz */}
      <CameraPreview stream={mediaStream} />
      <AudioLevelIndicator stream={mediaStream} />

      <button
        onClick={handleStartRecording}
        disabled={!mediaStream || countdown !== null}
        className="w-full mt-4 py-3 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
      >
        Record Demo
      </button>

      {/* Overlay con la cuenta regresiva superpuesta */}
      {countdown !== null && countdown > 0 && (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center rounded-xl z-50">
          <span className="text-8xl font-extrabold text-green-400 animate-pulse">
            {countdown}
          </span>
          <p className="mt-4 text-lg text-gray-300">Iniciando captura de datos de IA...</p>
        </div>
      )}
    </div>
  );
};
