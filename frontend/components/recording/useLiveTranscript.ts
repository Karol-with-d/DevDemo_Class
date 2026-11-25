"use client";

import { useEffect, useRef, useState } from "react";
import type { VideoStorage } from "../../lib/api";
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
  videoStorage?: VideoStorage;
  vocabulary?: TechnicalTerm[];
}

export type CaptionStatus = "connecting" | "live" | "saving" | "error";

const TARGET_RATE = 24000;
const SILENCE_RMS = 0.012;
const PAUSE_SECONDS = 0.5;
const MIN_UTTERANCE_SECONDS = 0.6;
const MAX_UTTERANCE_SECONDS = 8;
const PRE_ROLL_SECONDS = 0.3;
const SEND_SECONDS = 0.1;

interface Engine {
  ws: WebSocket | null;
  context: AudioContext | null;
  processor: ScriptProcessorNode | null;
  gain: GainNode | null;
  source: MediaStreamAudioSourceNode | null;
  preRollChunks: Float32Array[];
  preRollSamples: number;
  turnChunks: Float32Array[];
  pendingSamples: number;
  turnSamples: number;
  turnSilence: number;
  turnStart: number | null;
  startedAt: number;
  loggedPartial: boolean;
  sendChain: Promise<void>;
  pending: number;
  sentAt: number[];
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

function pcm16Base64(samples: Float32Array) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function mergeSamples(chunks: Float32Array[], total: number) {
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function elapsedSeconds(engine: Engine) {
  return (performance.now() - engine.startedAt) / 1000;
}

type LiveTiming = {
  audioSeconds?: number;
  bytes?: number;
  apiMs?: number;
  decodeMs?: number;
  waitMs?: number;
  saveMs?: number;
  reason?: string;
};

function logLiveReply(kind: string, sentAt: number[], timing?: LiveTiming) {
  const sent = sentAt.shift();
  const roundTrip = sent === undefined ? null : Math.round(performance.now() - sent);
  const detail = timing
    ? ` audio=${timing.audioSeconds ?? "?"}s api=${timing.apiMs ?? "?"}ms decode=${timing.decodeMs ?? "?"}ms wait=${timing.waitMs ?? "?"}ms save=${timing.saveMs ?? 0}ms reason=${timing.reason ?? "?"}`
    : "";
  console.info(
    `[TIME live] reply=${kind} roundTrip=${roundTrip === null ? "?" : `${roundTrip}ms`}${detail}`,
  );
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
      preRollChunks: [],
      preRollSamples: 0,
      turnChunks: [],
      pendingSamples: 0,
      turnSamples: 0,
      turnSilence: 0,
      turnStart: null,
      startedAt: performance.now(),
      loggedPartial: false,
      sendChain: Promise.resolve(),
      pending: 0,
      sentAt: [],
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
        timing?: LiveTiming;
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
      if (payload.type === "partial" && payload.text) {
        if (!engine.loggedPartial) {
          engine.loggedPartial = true;
          const sinceSpeech = engine.turnStart === null
            ? 0
            : Math.round(performance.now() - engine.startedAt - engine.turnStart * 1000);
          console.info(`[TIME live] partial ${payload.text.length}c sinceSpeech=${sinceSpeech}ms`);
        }
        setCaption(payload.text);
        return;
      }
      if (payload.type === "subtitle" && payload.text) {
        logLiveReply("subtitle", engine.sentAt, payload.timing);
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
        logLiveReply(payload.type, engine.sentAt, payload.timing);
        noteChunkFinished();
        if (payload.type === "chunk-done") {
          setCaption(engine.segments.at(-1)?.text ?? "");
        }
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

    const sendPcm = (samples: Float32Array) => {
      if (samples.length === 0) return;
      const pcm = pcm16Base64(samples);
      engine.sendChain = engine.sendChain.then(async () => {
        await engine.ready;
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({ type: "audio", pcm }));
      });
    };

    const takePending = () => {
      const samples = mergeSamples(engine.turnChunks, engine.pendingSamples);
      engine.turnChunks = [];
      engine.pendingSamples = 0;
      return samples;
    };

    const commitTurn = () => {
      const samples = takePending();
      if (engine.turnSamples <= 0 && samples.length === 0) {
        engine.turnStart = null;
        return;
      }
      const start = engine.turnStart ?? elapsedSeconds(engine);
      const end = elapsedSeconds(engine);
      engine.turnSamples = 0;
      engine.turnSilence = 0;
      engine.turnStart = null;
      engine.loggedPartial = false;
      engine.pending += 1;
      console.info(
        `[TIME live] commit audio=${(end - start).toFixed(2)}s inFlight=${engine.pending}`,
      );
      engine.sendChain = engine.sendChain.then(async () => {
        await engine.ready;
        if (socket.readyState !== WebSocket.OPEN) {
          noteChunkFinished();
          return;
        }
        if (samples.length > 0) {
          socket.send(JSON.stringify({ type: "audio", pcm: pcm16Base64(samples) }));
        }
        socket.send(JSON.stringify({ type: "commit", start, end }));
        engine.sentAt.push(performance.now());
      });
    };

    processor.onaudioprocess = (event) => {
      if (engine.stopped) return;
      const block = downsample(event.inputBuffer.getChannelData(0), context.sampleRate, TARGET_RATE);
      if (block.length === 0) return;
      const loud = rms(block) > SILENCE_RMS;
      if (engine.turnStart === null) {
        if (!loud) {
          engine.preRollChunks.push(block);
          engine.preRollSamples += block.length;
          const maxPreRoll = TARGET_RATE * PRE_ROLL_SECONDS;
          while (engine.preRollSamples > maxPreRoll && engine.preRollChunks.length > 1) {
            const dropped = engine.preRollChunks.shift();
            if (dropped) engine.preRollSamples -= dropped.length;
          }
          return;
        }
        const preRollDuration = engine.preRollSamples / TARGET_RATE;
        engine.turnStart = Math.max(0, elapsedSeconds(engine) - preRollDuration);
        if (engine.preRollSamples > 0) {
          engine.turnChunks.push(...engine.preRollChunks);
          engine.pendingSamples += engine.preRollSamples;
          engine.turnSamples += engine.preRollSamples;
          engine.preRollChunks = [];
          engine.preRollSamples = 0;
        }
      }
      engine.turnChunks.push(block);
      engine.pendingSamples += block.length;
      engine.turnSamples += block.length;
      engine.turnSilence = loud ? 0 : engine.turnSilence + block.length;
      if (engine.pendingSamples >= TARGET_RATE * SEND_SECONDS) {
        sendPcm(takePending());
      }
      const seconds = engine.turnSamples / TARGET_RATE;
      const paused = engine.turnSilence > TARGET_RATE * PAUSE_SECONDS;
      if ((seconds > MIN_UTTERANCE_SECONDS && paused) || seconds > MAX_UTTERANCE_SECONDS) {
        commitTurn();
      }
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

    if (engine.turnSamples > 0 || engine.pendingSamples > 0) {
      const samples = mergeSamples(engine.turnChunks, engine.pendingSamples);
      const committedSamples = engine.turnSamples;
      const start = engine.turnStart ?? elapsedSeconds(engine);
      const end = elapsedSeconds(engine);
      engine.turnChunks = [];
      engine.pendingSamples = 0;
      engine.turnSamples = 0;
      engine.turnSilence = 0;
      engine.turnStart = null;
      if (committedSamples >= TARGET_RATE * 0.3) {
        engine.pending += 1;
        engine.loggedPartial = false;
        console.info(`[TIME live] commit audio=${(end - start).toFixed(2)}s span=final`);
        engine.sendChain = engine.sendChain.then(async () => {
          await engine.ready;
          const socket = engine.ws;
          if (!socket || socket.readyState !== WebSocket.OPEN) {
            engine.pending = Math.max(0, engine.pending - 1);
            if (engine.pending === 0) {
              engine.drain.splice(0).forEach((resolve) => resolve());
            }
            return;
          }
          if (samples.length > 0) {
            socket.send(JSON.stringify({ type: "audio", pcm: pcm16Base64(samples) }));
          }
          socket.send(JSON.stringify({ type: "commit", start, end }));
          engine.sentAt.push(performance.now());
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
