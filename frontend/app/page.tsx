"use client";

import { useEffect, useRef, useState } from "react";
import { DeviceCalibration } from "../components/calibration/DeviceCalibration";
import { RotatePhonePrompt } from "../components/calibration/RotatePhonePrompt";
import { SplitRecordingInterface } from "../components/recording/SplitRecordingInterface";
import { TranscriptSaveResult } from "../components/recording/useLiveTranscript";
import { SessionSetup, SessionData } from "../components/session/SessionForm";

function cueClock(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

export default function Page() {
  const [step, setStep] = useState<"setup" | "calibration" | "recording" | "finished">("setup");
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
    void audioContext.close();
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
    void audioContext?.close();
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
          <div className="flex w-full max-w-xl flex-col items-center rounded-3xl border border-white/10 bg-[#11191e] p-8 text-center shadow-2xl sm:p-10">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[#9ce4c1]/10 text-2xl text-[#9ce4c1] shadow-[0_0_20px_rgba(156,228,193,0.2)]">
              ✓
            </div>
            <h2 className="mb-2 text-2xl font-bold">Grabación finalizada</h2>
            <p className="mb-6 text-sm text-[#82918f]">
              Los subtítulos de {sessionData?.candidateName} quedaron guardados con el momento en que habló.
            </p>
            <div className="mb-6 max-h-64 w-full overflow-y-auto rounded-2xl border border-white/10 bg-black/20 p-4 text-left">
              {savedTranscript?.segments.length ? (
                <ul className="flex flex-col gap-3">
                  {savedTranscript.segments.map((segment) => (
                    <li key={`${segment.start}-${segment.text}`} className="text-sm">
                      <span className="mr-2 font-semibold text-[#9ce4c1]">{cueClock(segment.start)}</span>
                      <span>{segment.text}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-[#82918f]">No se detectó voz durante la grabación.</p>
              )}
            </div>
            {savedTranscript?.vttPath && (
              <p className="mb-6 w-full break-all text-left text-xs text-[#82918f]">
                Subtítulos del video: {savedTranscript.vttPath}
              </p>
            )}
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
