'use client';
import { useEffect, useState } from 'react';

interface Props {
  stream: MediaStream | null;
}

export const AudioLevelIndicator = ({ stream }: Props) => {
  const [level, setLevel] = useState<number>(0);

  useEffect(() => {
    if (!stream) return;

    // Inicializa el analizador de audio del navegador
    const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const microphone = audioContext.createMediaStreamSource(stream);
    const javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);

    analyser.smoothingTimeConstant = 0.8;
    analyser.fftSize = 1024;

    microphone.connect(analyser);
    analyser.connect(javascriptNode);
    javascriptNode.connect(audioContext.destination);

    // Se ejecuta de forma continua mientras el usuario habla
    javascriptNode.onaudioprocess = () => {
      const array = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(array);
      let values = 0;
      for (let i = 0; i < array.length; i++) {
        values += array[i];
      }
      const average = values / array.length;
      // Ajusta el nivel entre 0 y 100%
      setLevel(Math.min(100, Math.round(average * 2)));
    };

    // Limpia al desmontar el componente para no sobrecargar el microprocesador
    return () => {
      javascriptNode.disconnect();
      analyser.disconnect();
      microphone.disconnect();
      audioContext.close();
    };
  }, [stream]);

  return (
    <div className="w-full my-4">
      <label className="block text-sm font-medium mb-1 text-gray-200">
        Nivel de Micrófono:
      </label>
      <div className="w-full bg-gray-700 h-4 rounded-full overflow-hidden">
        <div
          className="bg-green-500 h-full transition-all duration-75"
          style={{ width: `${level}%` }}
        />
      </div>
    </div>
  );
};
