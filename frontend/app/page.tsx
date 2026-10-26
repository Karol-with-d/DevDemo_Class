"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { DeviceCalibration } from "../components/calibration/DeviceCalibration";

const CameraComponent = dynamic(() => import("./CameraComponent"), {
  ssr: false,
  loading: () => (
    <div className="p-6 text-white bg-gray-950 min-h-screen">Cargando cámara...</div>
  ),
});

export default function Page() {
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  if (!stream) {
    return (
      <main className="min-h-screen bg-gray-950 p-8 flex flex-col items-center justify-center">
        <DeviceCalibration onCalibrationComplete={setStream} />
      </main>
    );
  }

  return <CameraComponent stream={stream} />;
}
