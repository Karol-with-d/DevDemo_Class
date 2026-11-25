"use client";

import { useEffect, useRef, useState } from "react";
import { DeviceCalibration } from "../components/calibration/DeviceCalibration";
import { RotatePhonePrompt } from "../components/calibration/RotatePhonePrompt";
import { SplitRecordingInterface } from "../components/recording/SplitRecordingInterface";
import { ConsolidatedReportView } from "../components/reports/ConsolidatedReportView";
import { EvaluationsOverview } from "../components/review/EvaluationsOverview";
import { SessionReview } from "../components/review/SessionReview";
import { SessionSetup, SessionData } from "../components/session/SessionForm";
import { SavedRecording } from "../lib/api";

export default function Page() {
  const [step, setStep] = useState<"setup" | "calibration" | "recording" | "finished" | "evaluations" | "history" | "evaluation">("setup");
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [reviewRecordings, setReviewRecordings] = useState<SavedRecording[] | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pageAlive = useRef(false);
  streamRef.current = stream;

  useEffect(() => {
    if (window.isSecureContext) return;
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return;
    const port = window.location.port ? `:${window.location.port}` : "";
    const target = `http://127.0.0.1${port}${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.replace(target);
  }, []);

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

  const handleStopRecording = () => {
    setStep("finished");
  };

  const handleNewSession = () => {
    stream?.getTracks().forEach((track) => track.stop());
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close().catch(() => undefined);
    }
    setAudioContext(null);
    setStream(null);
    setSessionData(null);
    setReviewRecordings(null);
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
              onClick={() => setStep("evaluations")}
              className="mt-4 w-full rounded-xl border border-white/15 py-3.5 text-sm font-semibold text-[#e9f0ed] hover:border-white/30"
            >
              Evaluaciones anteriores
            </button>
          </div>
        )}

        {step === "evaluations" && (
          <EvaluationsOverview
            onBack={() => setStep("setup")}
            onSelectCandidate={(recordings) => {
              setReviewRecordings(recordings);
              setStep("history");
            }}
          />
        )}

        {step === "history" && (
          <div className="w-full">
            <SessionReview
              session={sessionData}
              transcript={null}
              recordings={reviewRecordings ?? undefined}
              onBack={() => {
                setReviewRecordings(null);
                setStep("evaluations");
              }}
              onNewSession={handleNewSession}
            />
          </div>
        )}

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
          <div className="flex w-full max-w-md flex-col items-center rounded-3xl border border-white/10 bg-[#11191e] p-10 text-center shadow-2xl">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[#9ce4c1]/10 text-2xl text-[#9ce4c1] shadow-[0_0_20px_rgba(156,228,193,0.2)]">
              ✓
            </div>
            <h2 className="mb-2 text-2xl font-bold">Grabación finalizada</h2>
            <p className="mb-8 text-sm text-[#82918f]">
              La sesión del candidato{" "}
              <span className="font-semibold text-[#e9f0ed]">{sessionData?.candidateName || "registrado"}</span> se ha guardado correctamente.
            </p>
            <div className="flex w-full flex-col gap-3">
              <button
                type="button"
                onClick={() => setStep("evaluation")}
                className="w-full cursor-pointer rounded-xl bg-[#9ce4c1] py-3.5 text-sm font-bold text-[#0b1014] shadow-lg transition-all hover:bg-[#b1f0d2]"
              >
                Continuar a Rúbrica y Reporte
              </button>
              <button
                type="button"
                onClick={handleNewSession}
                className="w-full cursor-pointer rounded-xl border border-white/10 bg-transparent py-3 text-sm font-medium text-[#82918f] transition-all hover:bg-white/5 hover:text-white"
              >
                Iniciar nueva sesión
              </button>
            </div>
          </div>
        )}

        {step === "evaluation" && (
          <div className="w-full max-w-5xl pt-6">
            <div className="mb-4 flex justify-end">
              <button
                type="button"
                onClick={handleNewSession}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-white/15 bg-[#11191e]/90 px-4 py-1.5 text-xs font-medium text-[#e9f0ed] shadow-lg backdrop-blur-md transition-all hover:bg-white/10"
              >
                Volver al inicio
              </button>
            </div>
            <ConsolidatedReportView
              sessionId={sessionData?.sessionId || "SES-DEMO-01"}
              candidateName={sessionData?.candidateName || "Candidato"}
              evaluatorName={sessionData?.evaluatorName || ""}
              technology={sessionData?.technology || ""}
              complexity={sessionData?.complexity || ""}
            />
          </div>
        )}
      </main>
    </>
  );
}
