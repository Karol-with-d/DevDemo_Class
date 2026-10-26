"use client";
import dynamic from "next/dynamic";

// Disable Server-Side Rendering completely for the camera component
const CameraComponent = dynamic(() => import("./CameraComponent"), {
  ssr: false,
  loading: () => <div className="p-6 text-white bg-gray-950 min-h-screen">Cargando cámara...</div>,
});

export default function Page() {
  return <CameraComponent />;
}