"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const API_BASE = "http://127.0.0.1:8000";
const TARGET_RATE = 16000;
const SILENCE_RMS = 0.012;
const PAUSE_SECONDS = 0.45;
const MIN_CLIP_SECONDS = 0.7;
const MAX_CLIP_SECONDS = 5;

type Language = "es" | "en";

type Turn = {
  id: number;
  text: string;
  audioSeconds: number;
  apiMs: number;
  roundTripMs: number;
};

type ListenState = "idle" | "listening" | "error";

function downsample(input: Float32Array, inputRate: number, outputRate: number) {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const length = Math.max(0, Math.floor(input.length / ratio));
  const output = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;
    const current = input[index] ?? 0;
    const next = input[Math.min(index + 1, input.length - 1)] ?? current;
    output[i] = current + (next - current) * fraction;
  }
  return output;
}

function rms(samples: Float32Array) {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

function encodeWav(samples: Float32Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

function formatSeconds(value: number) {
  return `${value.toFixed(1)} s`;
}

function speedNote(turn: Turn) {
  if (turn.apiMs <= 0 || turn.audioSeconds <= 0) return "";
  const timesFaster = (turn.audioSeconds * 1000) / turn.apiMs;
  if (timesFaster >= 1) return ` · ${timesFaster.toFixed(1)}× más rápido que el audio`;
  return " · el modelo tardó más que el audio";
}

export default function GptTranscribeDemoPage() {
  const [status, setStatus] = useState<ListenState>("idle");
  const [language, setLanguage] = useState<Language>("es");
  const [level, setLevel] = useState(0);
  const [pending, setPending] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState("");
  const languageRef = useRef(language);
  const engineRef = useRef<{
    stream: MediaStream;
    context: AudioContext;
    processor: ScriptProcessorNode;
    source: MediaStreamAudioSourceNode;
    mute: GainNode;
    chunks: Float32Array[];
    samples: number;
    silence: number;
    chain: Promise<void>;
    stopped: boolean;
  } | null>(null);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  useEffect(() => {
    return () => {
      const engine = engineRef.current;
      if (!engine) return;
      engine.stopped = true;
      engine.stream.getTracks().forEach((track) => track.stop());
      engine.processor.disconnect();
      engine.source.disconnect();
      void engine.context.close().catch(() => undefined);
    };
  }, []);

  const stop = () => {
    const engine = engineRef.current;
    engineRef.current = null;
    if (!engine) {
      setStatus("idle");
      setLevel(0);
      return;
    }
    engine.stopped = true;
    engine.stream.getTracks().forEach((track) => track.stop());
    engine.processor.disconnect();
    engine.source.disconnect();
    void engine.context.close().catch(() => undefined);
    setStatus("idle");
    setLevel(0);
  };

  const sendClip = (samples: Float32Array) => {
    const engine = engineRef.current;
    if (!engine || samples.length < TARGET_RATE * 0.3) return;
    const wav = encodeWav(samples, TARGET_RATE);
    const body = new FormData();
    body.append("language", languageRef.current);
    body.append("file", new Blob([wav], { type: "audio/wav" }), "clip.wav");
    setPending((count) => count + 1);
    const started = performance.now();
    engine.chain = engine.chain
      .then(async () => {
        const response = await fetch(`${API_BASE}/demo/transcribe`, { method: "POST", body });
        const roundTripMs = Math.round(performance.now() - started);
        const raw = await response.text();
        if (!response.ok) {
          let message = "No se pudo transcribir ese fragmento.";
          try {
            const payload = JSON.parse(raw) as { detail?: string };
            if (payload.detail) message = payload.detail;
          } catch {
            if (raw) message = raw;
          }
          throw new Error(message);
        }
        const payload = JSON.parse(raw) as {
          text?: string;
          apiMs?: number;
          audioSeconds?: number;
          skipped?: boolean;
        };
        if (payload.skipped) return;
        console.info(
          `[TIME demo] audio=${(payload.audioSeconds ?? samples.length / TARGET_RATE).toFixed(2)}s api=${payload.apiMs ?? 0}ms roundTrip=${roundTripMs}ms`,
        );
        setError("");
        setTurns((current) => [
          {
            id: started,
            text: payload.text || "(el modelo no devolvió texto)",
            audioSeconds: payload.audioSeconds ?? samples.length / TARGET_RATE,
            apiMs: payload.apiMs ?? 0,
            roundTripMs,
          },
          ...current,
        ].slice(0, 12));
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "No se pudo transcribir.");
      })
      .finally(() => {
        setPending((count) => Math.max(0, count - 1));
      });
  };

  const start = async () => {
    setError("");
    setTurns([]);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const mute = context.createGain();
      mute.gain.value = 0;
      const engine = {
        stream,
        context,
        processor,
        source,
        mute,
        chunks: [] as Float32Array[],
        samples: 0,
        silence: 0,
        chain: Promise.resolve(),
        stopped: false,
      };
      engineRef.current = engine;
      processor.onaudioprocess = (event) => {
        if (engine.stopped) return;
        const input = event.inputBuffer.getChannelData(0);
        const block = downsample(input, context.sampleRate, TARGET_RATE);
        const loud = rms(block) >= SILENCE_RMS;
        setLevel(Math.min(1, rms(block) / 0.08));
        if (!loud && engine.samples === 0) return;
        engine.chunks.push(block);
        engine.samples += block.length;
        engine.silence = loud ? 0 : engine.silence + block.length;
        const seconds = engine.samples / TARGET_RATE;
        const paused = engine.silence / TARGET_RATE >= PAUSE_SECONDS;
        if ((seconds >= MIN_CLIP_SECONDS && paused) || seconds >= MAX_CLIP_SECONDS) {
          const merged = new Float32Array(engine.samples);
          let offset = 0;
          for (const chunk of engine.chunks) {
            merged.set(chunk, offset);
            offset += chunk.length;
          }
          engine.chunks = [];
          engine.samples = 0;
          engine.silence = 0;
          if (rms(merged) >= SILENCE_RMS) sendClip(merged);
        }
      };
      source.connect(processor);
      processor.connect(mute);
      mute.connect(context.destination);
      setStatus("listening");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No se pudo usar el micrófono. Revisa el permiso del navegador.",
      );
      setStatus("error");
    }
  };

  const last = turns[0];
  const averageApi =
    turns.length === 0
      ? 0
      : Math.round(turns.reduce((sum, turn) => sum + turn.apiMs, 0) / turns.length);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-6 md:p-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="eyebrow">gpt-transcribe</span>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Velocidad del micrófono</h1>
          <p className="mt-2 max-w-xl text-sm text-[#82918f]">
            Habla y haz una pausa. Cada frase se manda a GPT Transcribe y aquí ves cuánto tardó
            el modelo en devolver el texto.
          </p>
        </div>
        <Link href="/" className="shrink-0 text-sm text-[#9ce4c1] hover:underline">
          Volver
        </Link>
      </div>

      <section className="rounded-3xl border border-white/10 bg-[#11191e]/90 p-6 shadow-2xl">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <label className="text-sm text-[#82918f]">
            Idioma
            <select
              value={language}
              disabled={status === "listening"}
              onChange={(event) => setLanguage(event.target.value as Language)}
              className="ml-2 rounded-lg border border-white/15 bg-[#0b1014] px-3 py-2 text-sm text-[#e9f0ed]"
            >
              <option value="es">Español</option>
              <option value="en">English</option>
            </select>
          </label>
          {status === "listening" ? (
            <button
              type="button"
              onClick={stop}
              className="rounded-xl bg-[#e9f0ed] px-5 py-2.5 text-sm font-bold text-[#0b1014]"
            >
              Detener
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void start()}
              className="rounded-xl bg-[#9ce4c1] px-5 py-2.5 text-sm font-bold text-[#0b1014]"
            >
              Usar micrófono
            </button>
          )}
          <span className="text-sm text-[#82918f]">
            {status === "listening"
              ? pending > 0
                ? "Transcribiendo…"
                : "Escuchando"
              : "Micrófono apagado"}
          </span>
        </div>

        <div className="h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-[#9ce4c1] transition-[width] duration-75"
            style={{ width: `${Math.round(level * 100)}%` }}
          />
        </div>

        {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
      </section>

      <section className="grid grid-cols-3 gap-3">
        <Stat label="Última respuesta" value={last ? `${last.apiMs} ms` : "—"} />
        <Stat label="Audio de esa frase" value={last ? formatSeconds(last.audioSeconds) : "—"} />
        <Stat label="Promedio API" value={turns.length ? `${averageApi} ms` : "—"} />
      </section>

      <section className="flex flex-1 flex-col gap-3">
        {turns.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/15 px-5 py-8 text-sm text-[#82918f]">
            Todavía no hay frases. Enciende el micrófono, di una oración y espera la pausa.
          </p>
        ) : (
          turns.map((turn) => (
            <article key={turn.id} className="rounded-2xl border border-white/10 bg-[#11191e] px-5 py-4">
              <p className="text-base leading-relaxed">{turn.text}</p>
              <p className="mt-2 text-xs text-[#82918f]">
                {formatSeconds(turn.audioSeconds)} de audio · modelo {turn.apiMs} ms · ida y vuelta{" "}
                {turn.roundTripMs} ms
                {speedNote(turn)}
              </p>
            </article>
          ))
        )}
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#11191e] px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#82918f]">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </div>
  );
}
