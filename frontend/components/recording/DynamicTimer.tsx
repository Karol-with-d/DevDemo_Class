'use client';

import { useState, useEffect } from 'react';

interface DynamicTimerProps {
  isRecording: boolean;
  maxTimeSeconds?: number; // Tiempo límite en segundos (por defecto 15:00 = 900s)
}

export function DynamicTimer({
  isRecording,
  maxTimeSeconds = 900,
}: DynamicTimerProps) {
  const [secondsElapsed, setSecondsElapsed] = useState<number>(0);
  const [isOvertime, setIsOvertime] = useState<boolean>(false);

  // Contador en tiempo real
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    if (isRecording) {
      interval = setInterval(() => {
        setSecondsElapsed((prev) => {
          const nextSeconds = prev + 1;
          if (nextSeconds > maxTimeSeconds) {
            setIsOvertime(true);
          }
          return nextSeconds;
        });
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording, maxTimeSeconds]);

  // Simulación/Recepción del evento EDA vía WebSocket
  useEffect(() => {
    // Si la sesión excede el tiempo límite, se activa el estado de exceso
    if (secondsElapsed > maxTimeSeconds) {
      setIsOvertime(true);
    }
  }, [secondsElapsed, maxTimeSeconds]);

  // Formato de tiempo MM:SS
  const formatTime = (totalSeconds: number) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const formattedMinutes = String(minutes).padStart(2, '0');
    const formattedSeconds = String(seconds).padStart(2, '0');
    return `${formattedMinutes}:${formattedSeconds}`;
  };

  const maxTimeFormatted = formatTime(maxTimeSeconds);

  return (
    <div
      className={`px-4 py-2 rounded-xl font-mono text-sm font-bold transition-all duration-300 flex items-center gap-2 border ${
        isOvertime
          ? 'bg-red-950/80 text-red-400 border-red-500 animate-pulse'
          : 'bg-gray-800/90 text-emerald-400 border-gray-700'
      }`}
    >
      <span
        className={`w-2 h-2 rounded-full ${
          isOvertime ? 'bg-red-500 animate-ping' : 'bg-emerald-400'
        }`}
      />
      <span>
        {formatTime(secondsElapsed)} / {maxTimeFormatted} min
      </span>
      {isOvertime && (
        <span className="text-xs bg-red-600 text-white px-2 py-0.5 rounded uppercase font-sans font-extrabold tracking-wider">
          Exceso
        </span>
      )}
    </div>
  );
}