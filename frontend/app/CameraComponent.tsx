"use client";
import { useEffect, useRef, useState } from "react";

interface Metrics {
  movilidad: string;
  gesticulacion: string;
  status_color: string;
  orientacion: string;
  orientacion_color: string;
  de_espaldas: boolean;
  expresion: string;
  contacto_visual: string;
  contacto_visual_color: string;
}

interface CameraComponentProps {
  stream?: MediaStream | null;
  embedded?: boolean;
  caption?: string;
  previousCaption?: string;
  captionStatus?: "connecting" | "live" | "saving" | "error";
}

export default function CameraComponent({
  stream: providedStream,
  embedded = false,
  caption = "",
  previousCaption = "",
  captionStatus,
}: CameraComponentProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [metrics, setMetrics] = useState<Metrics>({
    movilidad: "Conectando al backend...",
    gesticulacion: "Conectando al backend...",
    status_color: "#9ca3af",
    orientacion: "Conectando al backend...",
    orientacion_color: "#9ca3af",
    de_espaldas: false,
    expresion: "Conectando al backend...",
    contacto_visual: "Conectando al backend...",
    contacto_visual_color: "#9ca3af",
  });
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [backendConnected, setBackendConnected] = useState(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let stream: MediaStream | null = null;
    let intervalId: NodeJS.Timeout | null = null;
    let isSubmitting = false;
    let isMounted = true;
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let poseSentAt = 0;
    let poseWaiting = false;
    let poseFrames = 0;
    let poseSlow = 0;

    const releaseSocket = (socket: WebSocket) => {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    };

    function connectWebSocket() {
      if (!isMounted) return;

      try {
        const socket = new WebSocket("ws://127.0.0.1:8000/ws/pose-analysis");
        ws = socket;

        socket.onopen = () => {
          if (!isMounted || ws !== socket) return;
          console.log("🟢 WebSocket Conectado al Backend");
          setBackendConnected(true);
        };

        socket.onmessage = (event) => {
          if (!isMounted || ws !== socket) return;
          poseWaiting = false;
          if (poseSentAt) {
            poseFrames += 1;
            const frameMs = Math.round(performance.now() - poseSentAt);
            poseSentAt = 0;
            if (frameMs >= 200) poseSlow += 1;
            if (frameMs >= 200 || poseFrames % 20 === 0) {
              console.info(
                `[TIME pose] frame=${frameMs}ms slow=${poseSlow}/${poseFrames}`,
              );
            }
          }
          try {
            const data: Metrics = JSON.parse(event.data);
            setMetrics(data);
          } catch (e) {
            console.error("Error parsing message:", e);
          }
        };

        socket.onclose = () => {
          if (!isMounted || ws !== socket) return;
          poseWaiting = false;
          poseSentAt = 0;
          console.log("🔴 WebSocket desconectado");
          setBackendConnected(false);
          setMetrics((prev) => ({
            ...prev,
            movilidad: "Desconectado del backend (puerto 8000)",
            orientacion: "Servidor no disponible",
            orientacion_color: "#ef4444",
            de_espaldas: false,
            gesticulacion: "Esperando reconexión...",
            status_color: "#ef4444",
          }));
          reconnectTimeout = setTimeout(connectWebSocket, 2000);
        };
      } catch (err) {
        console.error("Error creating WebSocket:", err);
        reconnectTimeout = setTimeout(connectWebSocket, 2000);
      }
    }

    connectWebSocket();

    const ownsStream = !providedStream;

    const attachStream = (mediaStream: MediaStream) => {
      if (!isMounted) {
        if (ownsStream) {
          mediaStream.getTracks().forEach((track) => track.stop());
        }
        return;
      }
      stream = mediaStream;
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      intervalId = setInterval(() => {
        const video = videoRef.current;
        if (
          video &&
          video.readyState >= 2 &&
          video.videoWidth > 0 &&
          ws &&
          ws.readyState === WebSocket.OPEN &&
          !isSubmitting &&
          !poseWaiting
        ) {
          isSubmitting = true;
          const scale = Math.min(1, 960 / video.videoWidth);
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);

          canvas.toBlob(
            (blob) => {
              try {
                if (blob && ws && ws.readyState === WebSocket.OPEN) {
                  poseWaiting = true;
                  poseSentAt = performance.now();
                  ws.send(blob);
                }
              } finally {
                isSubmitting = false;
              }
            },
            "image/jpeg",
            0.7
          );
        }
      }, 100);
    };

    // The calibration step already opened the camera. Reuse that stream.
    if (providedStream) {
      attachStream(providedStream);
    } else if (navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        })
        .then(attachStream)
        .catch((err) => {
          console.error("🔴 Error al acceder a la cámara:", err);
          if (isMounted) {
            setCameraError(
              "No se pudo acceder a la cámara. Por favor verifica los permisos o que otra aplicación no la esté usando."
            );
          }
        });
    } else {
      queueMicrotask(() => {
        if (isMounted) {
          setCameraError("Tu navegador no soporta acceso a la cámara web.");
        }
      });
    }

    return () => {
      isMounted = false;
      if (intervalId) clearInterval(intervalId);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws) {
        releaseSocket(ws);
        ws = null;
      }
      if (ownsStream && stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [providedStream]);

  return (
    <div className={`analysis-shell flex flex-col md:flex-row gap-4 text-white ${embedded ? "min-h-0 bg-transparent p-0" : "min-h-screen bg-gray-950 p-3 sm:p-6"}`}>
      {/* Live Video Feed */}
      <div
        className={`analysis-video w-full md:w-1/2 min-w-0 bg-black rounded-xl overflow-hidden flex flex-col items-center justify-center border transition-all duration-300 relative aspect-video md:aspect-auto md:min-h-[460px] ${
          metrics.de_espaldas
            ? "border-red-500 shadow-[0_0_30px_rgba(239,68,68,0.6)] ring-2 ring-red-500"
            : "border-gray-800"
        }`}
      >
        {cameraError ? (
          <div className="p-6 text-center text-red-400">
            <p className="text-lg font-bold mb-2">Error de Cámara</p>
            <p className="text-sm">{cameraError}</p>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="camera-feed w-full h-full object-cover"
          />
        )}

        {/* Live Warning Banner When Back is Turned */}
        {metrics.de_espaldas && (
          <div className="absolute inset-x-2 top-12 sm:inset-x-4 sm:top-16 bg-red-600/95 backdrop-blur-md text-white p-2.5 sm:p-3 rounded-xl border border-red-300 shadow-2xl flex items-start gap-2 sm:gap-3 z-20">
            <span className="text-2xl sm:text-3xl leading-none">⚠️</span>
            <div className="min-w-0">
              <p className="font-extrabold text-sm tracking-wide">
                {metrics.orientacion}
              </p>
              <p className="text-xs text-red-100">
                El docente debe mantener la vista hacia la cámara y los estudiantes en todo momento.
              </p>
            </div>
          </div>
        )}

        {captionStatus && (
          <>
            <div className="absolute top-2 right-2 z-10 rounded-full border border-gray-700 bg-black/70 px-3 py-1 text-[11px] text-white backdrop-blur sm:top-3 sm:right-3 sm:text-xs">
              {captionStatus === "live"
                ? "Subtítulos en vivo"
                : captionStatus === "saving"
                  ? "Guardando subtítulos..."
                  : captionStatus === "error"
                    ? "Subtítulos no disponibles"
                    : "Conectando subtítulos..."}
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-4 pb-4 pt-12">
              {previousCaption && (
                <p className="mb-1 line-clamp-2 text-center text-xs text-white/70 sm:text-sm">{previousCaption}</p>
              )}
              <p className="line-clamp-3 text-center text-sm font-semibold text-white sm:text-lg">
                {caption ||
                  (captionStatus === "error"
                    ? "No se pudo transcribir el audio de la cámara"
                    : captionStatus === "saving"
                      ? "Guardando lo que dijo el candidato..."
                      : captionStatus === "connecting"
                        ? "Conectando con Whisper..."
                        : "Escuchando al candidato...")}
              </p>
            </div>
          </>
        )}

        {/* Status Badge */}
        <div className="absolute top-2 left-2 sm:top-3 sm:left-3 max-w-[calc(100%-5.5rem)] bg-black/70 backdrop-blur px-3 py-1 rounded-full text-[11px] sm:text-xs flex items-center gap-2 z-10 border border-gray-700">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              backendConnected ? "bg-green-500 animate-pulse" : "bg-red-500"
            }`}
          />
          {backendConnected ? "Backend Conectado (8000)" : "Backend Desconectado"}
        </div>
      </div>

      {/* Real-time Feedback Panel */}
      <div className="analysis-panel w-full md:w-1/2 min-w-0 bg-gray-900 p-4 sm:p-6 rounded-xl flex flex-col justify-between gap-4 border border-gray-800">
        <div className="analysis-heading">
          <h2 className="text-2xl sm:text-3xl font-bold text-blue-400">Feedback de Postura en Vivo</h2>
          <p className="analysis-subtitle text-sm text-gray-400 mt-1">
            Análisis biométrico y facial en tiempo real vía MediaPipe (Pose + Face Landmarker)
          </p>
        </div>

        {/* 1. Orientación Corporal (Alerta de espaldas) */}
        <div
          className={`analysis-metric p-4 rounded-xl border transition-all duration-300 ${
            metrics.de_espaldas
              ? "bg-red-950/70 border-red-500 shadow-lg ring-1 ring-red-500"
              : "bg-gray-800 border-gray-700"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <p className="text-sm uppercase tracking-wider font-semibold text-gray-400">
              Orientación hacia la Cámara:
            </p>
            {metrics.de_espaldas && (
              <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse">
                CORREGIR POSTURA
              </span>
            )}
          </div>
          <p
            className="text-2xl font-bold flex items-center gap-2"
            style={{ color: metrics.orientacion_color }}
          >
            {metrics.de_espaldas && <span>⚠️</span>}
            {metrics.orientacion}
          </p>
          {metrics.de_espaldas && (
            <p className="analysis-note text-sm text-red-300 mt-1">
              Gira hacia el frente para no perder la conexión visual con los alumnos.
            </p>
          )}
        </div>

        {/* 2. Contacto Visual y Expresión Facial (Face Landmarker) */}
        <div className="analysis-pair grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
          <div className="analysis-metric p-3.5 rounded-lg bg-gray-800 border border-gray-700">
            <p className="text-sm text-gray-400 mb-1">Contacto Visual:</p>
            <p
              className="text-2xl font-semibold"
              style={{ color: metrics.contacto_visual_color || "#22c55e" }}
            >
              {metrics.contacto_visual}
            </p>
          </div>

          <div className="analysis-metric p-3.5 rounded-lg bg-gray-800 border border-gray-700">
            <p className="text-sm text-gray-400 mb-1">Expresión Facial:</p>
            <p className="text-2xl font-semibold text-amber-300">
              {metrics.expresion}
            </p>
          </div>
        </div>

        {/* 3. Estado de Movilidad */}
        <div className="analysis-metric p-4 rounded-lg bg-gray-800 border border-gray-700">
          <p className="text-base text-gray-400 mb-1">Dinamismo / Movilidad Corporal:</p>
          <p className="text-2xl font-bold" style={{ color: metrics.status_color }}>
            {metrics.movilidad}
          </p>
        </div>

        {/* 4. Uso de Gestos */}
        <div className="analysis-metric p-4 rounded-lg bg-gray-800 border border-gray-700">
          <p className="text-base text-gray-400 mb-1">Uso de Gestos con las Manos:</p>
          <p className="text-2xl font-bold text-white">{metrics.gesticulacion}</p>
        </div>
      </div>
    </div>
  );
}