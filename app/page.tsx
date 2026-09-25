'use client';
import { DeviceCalibration } from '../components/calibration/DeviceCalibration';

export default function Home() {
  const handleCalibrationComplete = (stream: MediaStream) => {
    // Aquí es donde conectarás la pantalla de grabación de la US03
    console.log('Stream de calibración listo:', stream);
  };

  return (
    <main className="min-h-screen p-8 bg-gray-950 flex flex-col items-center justify-center">
      <DeviceCalibration onCalibrationComplete={handleCalibrationComplete} />
    </main>
  );
}