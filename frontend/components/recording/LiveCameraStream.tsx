'use client';

import React, { useEffect, useRef } from 'react';

interface LiveCameraStreamProps {
  stream: MediaStream | null;
}

export function LiveCameraStream({ stream }: LiveCameraStreamProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="relative w-full h-full bg-black rounded-xl overflow-hidden border border-gray-800 flex items-center justify-center">
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
          Cámara no conectada
        </div>
      )}

      <div className="absolute top-4 left-4 bg-red-600/80 text-white text-xs px-3 py-1 rounded-full font-medium flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-white animate-ping" />
        EN VIVO
      </div>
    </div>
  );
}