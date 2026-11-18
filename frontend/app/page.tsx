"use client";

import { useEffect, useRef, useState } from "react";
import { DeviceCalibration } from "../components/calibration/DeviceCalibration";
import { RotatePhonePrompt } from "../components/calibration/RotatePhonePrompt";
import { SplitRecordingInterface } from "../components/recording/SplitRecordingInterface";
import { TechnicalTranscript } from "../components/recording/TechnicalTranscript";
import { TranscriptSaveResult } from "../components/recording/useLiveTranscript";
import { RecordingsLibrary } from "../components/recordings/RecordingsLibrary";
import { SessionSetup, SessionData } from "../components/session/SessionForm";
import { deleteRecording, playbackUrlForKey } from "../lib/api";

export default function Page() {
  const [step, setStep] = useState<"setup" | "calibration" | "recording" | "finished" | "library">("setup");
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [savedTranscript, setSavedTranscript] = useState<TranscriptSaveResult | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pageAlive = useRef(false);
  streamRef.current = stream;

  useEffect(() => {
    pageAlive.current = true;
    return () => {
      pageAlive.current = false;
      const current = streamRef.current;
      // Dev remounts this page immediately. Releasing the camera in that
      // pass ends the recording before Whisper can hear it.
      setTimeout(() => {
        if (!pageAlive.current) {
          current?.getTracks().forEach((track) => track.stop());
        }
      }, 0);
    };
  }, []);

  useEffect(() => {
    if (step !== "finished" || !audioContext || audioContext.state === "closed") return;
    void audioContext.close().catch(() => undefined);
  }, [step, audioContext]);

  const handleSessionReady = (data: SessionData) => {
    setSessionData(data);
    setStep("calibration");
  };

  const handleCalibrationComplete = (nextStream: MediaStream, nextAudio: AudioContext) => {
    setStream(nextStream);
    setAudioContext(nextAudio);
    setStep("recording");
  };

  const handleStopRecording = (transcript: TranscriptSaveResult) => {
    setSavedTranscript(transcript);
    setStep("finished");
  };

  const handleNewSession = () => {
    stream?.getTracks().forEach((track) => track.stop());
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close().catch(() => undefined);
    }
    if (savedTranscript?.videoUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(savedTranscript.videoUrl);
    }
    setAudioContext(null);
    setStream(null);
    setSessionData(null);
    setSavedTranscript(null);
    setStep("setup");
  };

  return (
    <>
      <RotatePhonePrompt />
      <main
        className={`flex min-h-screen w-full flex-col items-center justify-center p-6 text-[#e9f0ed] md:p-10 ${
          step === "recording" ? "recording-page" : ""
        }`}
      >
        {step === "setup" && (
          <div className="w-full max-w-xl">
            <SessionSetup onSessionReady={handleSessionReady} />
            <button
              type="button"
              onClick={() => setStep("library")}
              className="mt-4 w-full rounded-xl border border-white/15 py-3.5 text-sm font-semibold text-[#e9f0ed] hover:border-white/30"
            >
              Grabaciones guardadas
            </button>
          </div>
        )}

        {step === "library" && <RecordingsLibrary onBack={() => setStep("setup")} />}

        {step === "calibration" && (
          <div className="calibration-page w-full max-w-4xl rounded-3xl border border-white/10 bg-[#11191e]/90 p-8 shadow-2xl backdrop-blur-md">
            <DeviceCalibration onCalibrationComplete={handleCalibrationComplete} />
          </div>
        )}

        {step === "recording" && stream && sessionData && (
          <SplitRecordingInterface
            stream={stream}
            session={sessionData}
            audioContext={audioContext}
            onStopRecording={handleStopRecording}
          />
        )}

        {step === "finished" && (
          <div className="flex w-full max-w-3xl flex-col items-center rounded-3xl border border-white/10 bg-[#11191e] p-8 text-center shadow-2xl sm:p-10">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[#9ce4c1]/10 text-2xl text-[#9ce4c1] shadow-[0_0_20px_rgba(156,228,193,0.2)]">
              ✓
            </div>
            <h2 className="mb-2 text-2xl font-bold">Grabación finalizada</h2>
            <p className="mb-6 text-sm text-[#82918f]">
              Los subtítulos de {sessionData?.candidateName} quedaron guardados con el momento en que habló.
            </p>
            {savedTranscript?.videoUrl ? (
              <video
                className="mb-6 aspect-video w-full rounded-2xl bg-black"
                src={savedTranscript.videoUrl}
                controls
                playsInline
                preload="auto"
              />
            ) : (
              <p className="mb-6 text-sm text-[#82918f]">
                El video no se pudo subir. Los subtítulos sí quedaron guardados.
              </p>
            )}
            <TechnicalTranscript
              segments={savedTranscript?.segments ?? []}
              vocabulary={savedTranscript?.vocabulary ?? []}
            />
            {savedTranscript?.vttPath && (
              <p className="mb-6 w-full break-all text-left text-xs text-[#82918f]">
                Subtítulos del video: {savedTranscript.vttPath}
              </p>
            )}
            {savedTranscript?.videoKey ? (
              <p className="mb-4 w-full text-left text-sm text-[#9ce4c1]">
                Guardado en el sistema. Puedes descargarlo o abrirlo después en Grabaciones.
              </p>
            ) : null}
            <div className="mb-3 flex w-full flex-col gap-2 sm:flex-row">
              {savedTranscript?.videoKey && (
                <a
                  className="flex-1 rounded-xl border border-white/15 py-3.5 text-center text-sm font-bold text-[#e9f0ed] hover:border-white/30"
                  href={playbackUrlForKey(savedTranscript.videoKey, true)}
                >
                  Guardar en dispositivo
                </a>
              )}
              {savedTranscript?.videoKey && sessionData && (
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm("¿Eliminar esta grabación del sistema y de S3?")) return;
                    try {
                      await deleteRecording(sessionData.sessionId);
                      handleNewSession();
                    } catch (error) {
                      window.alert(error instanceof Error ? error.message : "No se pudo eliminar.");
                    }
                  }}
                  className="flex-1 rounded-xl border border-red-400/40 py-3.5 text-sm font-bold text-red-300 hover:bg-red-950/40"
                >
                  Eliminar
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setStep("library")}
              className="mb-3 w-full rounded-xl border border-white/15 py-3.5 text-sm font-semibold text-[#e9f0ed]"
            >
              Ver grabaciones guardadas
            </button>
            <button
              onClick={handleNewSession}
              className="w-full cursor-pointer rounded-xl bg-[#9ce4c1] py-3.5 text-sm font-bold text-[#0b1014] shadow-lg transition-all hover:bg-[#b1f0d2]"
            >
              Iniciar nueva sesión
            </button>
          </div>
        )}
      </main>
    </>
  );
}
