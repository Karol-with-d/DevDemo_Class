"use client";

import { useEffect, useState } from "react";
import { DeviceCalibration } from "../components/calibration/DeviceCalibration";
import { RotatePhonePrompt } from "../components/calibration/RotatePhonePrompt";
import { SplitRecordingInterface } from "../components/recording/SplitRecordingInterface";
import { SessionSetup, SessionData } from "../components/session/SessionForm";

export default function Page() {
  const [step, setStep] = useState<"setup" | "calibration" | "recording" | "finished">("setup");
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  const handleSessionReady = (data: SessionData) => {
    setSessionData(data);
    setStep("calibration");
  };

  const handleCalibrationComplete = (nextStream: MediaStream) => {
    setStream(nextStream);
    setStep("recording");
  };

  const handleStopRecording = () => {
    setStep("finished");
  };

  const handleNewSession = () => {
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    setSessionData(null);
    setStep("setup");
  };

  return (
    <>
      <RotatePhonePrompt />
      <main className="flex min-h-screen w-full flex-col items-center justify-center p-6 text-[#e9f0ed] md:p-10">
        {step === "setup" && (
          <div className="w-full max-w-xl">
            <SessionSetup onSessionReady={handleSessionReady} />
          </div>
        )}

        {step === "calibration" && (
          <div className="calibration-page w-full max-w-4xl rounded-3xl border border-white/10 bg-[#11191e]/90 p-8 shadow-2xl backdrop-blur-md">
            <DeviceCalibration onCalibrationComplete={handleCalibrationComplete} />
          </div>
        )}

        {step === "recording" && stream && (
          <SplitRecordingInterface
            stream={stream}
            candidateName={sessionData?.candidateName}
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
              La sesión del candidato {sessionData?.candidateName} se ha guardado correctamente.
            </p>
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
