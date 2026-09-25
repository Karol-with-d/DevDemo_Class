'use client';
import { useEffect, useRef } from 'react'; // se ejecuta cada vez que el componente recibe el flujo de video

interface Props {
  stream: MediaStream | null;
}

export const CameraPreview = ({ stream }: Props) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      // Conecta la señal de la cámara directamente con la etiqueta HTML <video>
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden border border-gray-800 flex items-center justify-center">
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="text-gray-400 text-sm">
          Esperando acceso a la cámara...
        </div>
      )}
    </div>
  );
};