"use client";

import { useEffect, useRef, useState } from "react";
import type { SessionData } from "../session/SessionForm";

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TechnicalTerm {
  term: string;
  lemma?: string;
  category?: string;
}

export interface TranscriptSaveResult {
  segments: TranscriptSegment[];
  jsonPath: string | null;
  vttPath: string | null;
  txtPath: string | null;
  docxPath: string | null;
  videoUrl?: string | null;
  videoKey?: string | null;
  vocabulary?: TechnicalTerm[];
}

export type CaptionStatus = "connecting" | "live" | "saving" | "error";

const TARGET_RATE = 16000;
const SILENCE_RMS = 0.012;
const PAUSE_SECONDS = 0.8;
const MIN_UTTERANCE_SECONDS = 2.5;
const MAX_UTTERANCE_SECONDS = 10;

interface Engine {
  ws: WebSocket | null;
  context: AudioContext | null;
  processor: ScriptProcessorNode | null;
  gain: GainNode | null;
  source: MediaStreamAudioSourceNode | null;
  chunks: Float32Array[];
  samples: number;
  silence: number;
  startedAt: number;
  bufferStartedAt: number | null;
  sendChain: Promise<void>;
  pending: number;
  drain: Array<() => void>;
  segments: TranscriptSegment[];
  ready: Promise<void>;
  markReady: () => void;
  stopped: boolean;
  saved: TranscriptSaveResult | null;
  saveWaiters: Array<(result: TranscriptSaveResult) => void>;
}

function emptyResult(segments: TranscriptSegment[]): TranscriptSaveResult {
  return {
    segments,
    jsonPath: null,
    vttPath: null,
    txtPath: null,
    docxPath: null,
    videoUrl: null,
    videoKey: null,
    vocabulary: [],
  };
}

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

function elapsedSeconds(engine: Engine) {
  return (performance.now() - engine.startedAt) / 1000;
}

export function useLiveTranscript(
  stream: MediaStream | null,
  session: SessionData,
  sharedAudio?: AudioContext | null,
) {
  const engineRef = useRef<Engine | null>(null);
  const [caption, setCaption] = useState("");
  const [previousCaption, setPreviousCaption] = useState("");
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [status, setStatus] = useState<CaptionStatus>("connecting");

  useEffect(() => {
    if (!stream) return;

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      setStatus("error");
      return;
    }

    let disposed = false;
    let markReady = () => {};
    const readyPromise = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const engine: Engine = {
      ws: null,
      context: null,
      processor: null,
      gain: null,
      source: null,
      chunks: [],
      samples: 0,
      silence: 0,
      startedAt: performance.now(),
      bufferStartedAt: null,
      sendChain: Promise.resolve(),
      pending: 0,
      drain: [],
      segments: [],
      ready: readyPromise,
      markReady,
      stopped: false,
      saved: null,
      saveWaiters: [],
    };
    engineRef.current = engine;

    const noteChunkFinished = () => {
      engine.pending = Math.max(0, engine.pending - 1);
      if (engine.pending === 0) {
        const waiting = engine.drain.splice(0);
        waiting.forEach((resolve) => resolve());
      }
    };

    const publish = (segment: TranscriptSegment) => {
      engine.segments = [...engine.segments, segment];
      setSegments(engine.segments);
      setPreviousCaption(engine.segments.at(-2)?.text ?? "");
      setCaption(segment.text);
    };

    const socket = new WebSocket("ws://127.0.0.1:8000/ws/transcription");
    engine.ws = socket;

    socket.onopen = () => {
      if (disposed) return;
      socket.send(JSON.stringify({ type: "start", ...session }));
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      let payload: {
        type?: string;
        text?: string;
        start?: number;
        end?: number;
        message?: string;
        segments?: TranscriptSegment[];
        jsonPath?: string | null;
        vttPath?: string | null;
        txtPath?: string | null;
        docxPath?: string | null;
        vocabulary?: TechnicalTerm[];
      };
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }

      if (payload.type === "ready") {
        engine.markReady();
        setStatus("live");
        return;
      }
      if (payload.type === "subtitle" && payload.text) {
        publish({
          start: payload.start ?? 0,
          end: payload.end ?? 0,
          text: payload.text,
        });
        setStatus((current) => (current === "saving" ? current : "live"));
        noteChunkFinished();
        return;
      }
      if (payload.type === "chunk-done" || payload.type === "error") {
        noteChunkFinished();
        return;
      }
      if (payload.type === "saved") {
        const result: TranscriptSaveResult = {
          segments: payload.segments?.length ? payload.segments : engine.segments,
          jsonPath: payload.jsonPath ?? null,
          vttPath: payload.vttPath ?? null,
          txtPath: payload.txtPath ?? null,
          docxPath: payload.docxPath ?? null,
          vocabulary: payload.vocabulary ?? [],
        };
        engine.saved = result;
        engine.segments = result.segments;
        setSegments(result.segments);
        engine.saveWaiters.splice(0).forEach((resolve) => resolve(result));
      }
    };

    socket.onerror = () => {
      if (!disposed) setStatus("error");
    };

    socket.onclose = () => {
      engine.markReady();
      if (!engine.saved) {
        const result = emptyResult(engine.segments);
        engine.saved = result;
        engine.saveWaiters.splice(0).forEach((resolve) => resolve(result));
      }
      if (!disposed && !engine.stopped) setStatus("error");
    };

    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ownsContext = !sharedAudio || sharedAudio.state === "closed";
    const context = ownsContext ? new AudioContextClass() : sharedAudio;
    engine.context = context;
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const gain = context.createGain();
    gain.gain.value = 0;
    engine.source = source;
    engine.processor = processor;
    engine.gain = gain;

    const takeBuffer = () => {
      const merged = new Float32Array(engine.samples);
      let offset = 0;
      for (const chunk of engine.chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      const start = engine.bufferStartedAt ?? elapsedSeconds(engine);
      engine.chunks = [];
      engine.samples = 0;
      engine.silence = 0;
      engine.bufferStartedAt = null;
      return { samples: merged, start, end: elapsedSeconds(engine) };
    };

    const enqueueWav = (samples: Float32Array, start: number, end: number) => {
      if (samples.length < TARGET_RATE * 0.3 || rms(samples) < SILENCE_RMS) return;
      engine.pending += 1;
      engine.sendChain = engine.sendChain.then(async () => {
        if (engine.stopped && socket.readyState !== WebSocket.OPEN) {
          noteChunkFinished();
          return;
        }
        await engine.ready;
        if (socket.readyState !== WebSocket.OPEN) {
          noteChunkFinished();
          return;
        }
        socket.send(JSON.stringify({ type: "chunk", start, end }));
        socket.send(encodeWav(samples, TARGET_RATE));
      });
    };

    const flush = (force: boolean) => {
      if (engine.samples === 0) return;
      const seconds = engine.samples / TARGET_RATE;
      const paused = engine.silence > TARGET_RATE * PAUSE_SECONDS;
      const readyToSend = (seconds > MIN_UTTERANCE_SECONDS && paused) || seconds > MAX_UTTERANCE_SECONDS;
      if (!force && !readyToSend) return;
      const utterance = takeBuffer();
      enqueueWav(utterance.samples, utterance.start, utterance.end);
    };

    processor.onaudioprocess = (event) => {
      if (engine.stopped) return;
      const block = downsample(event.inputBuffer.getChannelData(0), context.sampleRate, TARGET_RATE);
      if (block.length === 0) return;
      if (engine.samples === 0) engine.bufferStartedAt = elapsedSeconds(engine);
      engine.chunks.push(block);
      engine.samples += block.length;
      engine.silence = rms(block) > SILENCE_RMS ? 0 : engine.silence + block.length;
      flush(false);
    };

    source.connect(processor);
    processor.connect(gain);
    gain.connect(context.destination);
    void context.resume();
    const readyTimer = window.setTimeout(() => engine.markReady(), 8000);

    return () => {
      disposed = true;
      window.clearTimeout(readyTimer);
      engine.stopped = true;
      processor.onaudioprocess = null;
      processor.disconnect();
      gain.disconnect();
      source.disconnect();
      if (ownsContext && context.state !== "closed") {
        void context.close().catch(() => undefined);
      }
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [stream, session, sharedAudio]);

  const finish = async () => {
    const engine = engineRef.current;
    setStatus("saving");
    if (!engine || engine.stopped) {
      return engine?.saved ?? emptyResult(segments);
    }
    engine.stopped = true;
    if (engine.processor) engine.processor.onaudioprocess = null;

    if (engine.samples > 0) {
      const merged = new Float32Array(engine.samples);
      let offset = 0;
      for (const chunk of engine.chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      const start = engine.bufferStartedAt ?? elapsedSeconds(engine);
      engine.chunks = [];
      engine.samples = 0;
      engine.bufferStartedAt = null;
      if (merged.length >= TARGET_RATE * 0.3 && rms(merged) >= SILENCE_RMS) {
        engine.pending += 1;
        const wav = encodeWav(merged, TARGET_RATE);
        engine.sendChain = engine.sendChain.then(async () => {
          await engine.ready;
          const socket = engine.ws;
          if (!socket || socket.readyState !== WebSocket.OPEN) {
            engine.pending = Math.max(0, engine.pending - 1);
            return;
          }
          socket.send(JSON.stringify({ type: "chunk", start, end: elapsedSeconds(engine) }));
          socket.send(wav);
        });
      }
    }

    await engine.sendChain.catch(() => undefined);
    if (engine.pending > 0) {
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 20000);
        engine.drain.push(() => {
          window.clearTimeout(timer);
          resolve();
        });
      });
    }

    const saved = new Promise<TranscriptSaveResult>((resolve) => {
      if (engine.saved) {
        resolve(engine.saved);
        return;
      }
      const timer = window.setTimeout(() => resolve(emptyResult(engine.segments)), 8000);
      engine.saveWaiters.push((result) => {
        window.clearTimeout(timer);
        resolve(result);
      });
    });

    const socket = engine.ws;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "stop" }));
    } else if (!engine.saved) {
      const local = emptyResult(engine.segments);
      engine.saved = local;
      engine.saveWaiters.splice(0).forEach((resolve) => resolve(local));
    }

    return saved;
  };

  return { caption, previousCaption, segments, status, finish };
}
