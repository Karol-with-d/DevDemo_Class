"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { MuletillasSummary } from "../../lib/api";

export type TechnicalTerm = {
  term: string;
  lemma?: string;
  category?: string;
  section?: string;
};

export type TranscriptCue = {
  start: number;
  end?: number;
  text: string;
};

const SECTION_ORDER = ["javascript", "react", "node", "python", "fastapi", "general"];

const SECTION_LABELS: Record<string, string> = {
  javascript: "JavaScript / TypeScript",
  react: "React / Next.js",
  node: "Node.js / Express",
  python: "Python",
  fastapi: "FastAPI",
  general: "General",
};

// Keep in sync with vocab_extractor._MULETILLA_PATTERNS (multi-word phrases first).
const MULETILLA_SOURCE = [
  "o\\s+sea",
  "la\\s+verdad",
  "es\\s+que",
  "como\\s+que",
  "ahm+",
  "am+",
  "emm+",
  "em+",
  "um+",
  "uhm+",
  "eh+",
  "uh+",
  "ah+",
  "mm+",
  "aj[aá]+",
  "ah[aá]+",
  "este+",
  "pues",
  "bueno",
  "verdad",
  "digamos",
  "b[aá]sicamente",
  "entonces",
  "vale",
  "okey",
  "okay",
  "ok",
].join("|");

const MULETILLA_REGEX = new RegExp(
  `(?<![\\p{L}\\p{N}_])(?:${MULETILLA_SOURCE})(?![\\p{L}\\p{N}_])`,
  "giu",
);

function cueClock(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function groupBySection(terms: TechnicalTerm[]) {
  const groups = new Map<string, TechnicalTerm[]>();
  for (const item of terms) {
    const key = item.section || "general";
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return [...groups.entries()].sort(
    (a, b) => SECTION_ORDER.indexOf(a[0]) - SECTION_ORDER.indexOf(b[0]),
  );
}

function highlightMuletillas(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  MULETILLA_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  let hitIdx = 0;

  while ((match = MULETILLA_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        <span key={`${keyPrefix}-t-${hitIdx}`}>{text.slice(lastIndex, match.index)}</span>,
      );
    }
    nodes.push(
      <mark
        key={`${keyPrefix}-m-${hitIdx}`}
        title="Muletilla detectada"
        className="rounded-sm bg-amber-400/20 px-1 font-medium text-amber-300 underline decoration-amber-400/50 decoration-dotted underline-offset-2"
      >
        {match[0]}
      </mark>,
    );
    lastIndex = match.index + match[0].length;
    hitIdx += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(<span key={`${keyPrefix}-tail`}>{text.slice(lastIndex)}</span>);
  }
  return nodes.length ? nodes : [<span key={`${keyPrefix}-raw`}>{text}</span>];
}

function highlightText(text: string, terms: TechnicalTerm[]): ReactNode {
  const unique = [
    ...new Set(
      terms.flatMap((item) => [item.term, item.lemma || ""]).filter((value) => value.length > 1),
    ),
  ].sort((a, b) => b.length - a.length);

  if (!unique.length) {
    return highlightMuletillas(text, "seg");
  }

  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(${unique.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}_])`,
    "giu",
  );
  const parts = text.split(pattern);
  return parts.map((part, index) => {
    if (!part) return null;
    const isHit = unique.some((term) => term.toLowerCase() === part.toLowerCase());
    if (isHit) {
      return (
        <mark
          key={`tech-${index}`}
          title="Vocabulario técnico"
          className="rounded-sm bg-[#9ce4c1]/25 px-1 font-semibold text-[#9ce4c1]"
        >
          {part}
        </mark>
      );
    }
    return <span key={`plain-${index}`}>{highlightMuletillas(part, `p-${index}`)}</span>;
  });
}

export function TechnicalTranscript({
  segments,
  vocabulary,
  muletillas,
  currentTime,
  onSeek,
}: {
  segments: TranscriptCue[];
  vocabulary: TechnicalTerm[];
  muletillas?: MuletillasSummary | null;
  currentTime?: number;
  onSeek?: (seconds: number) => void;
}) {
  const groups = groupBySection(vocabulary);
  const activeItemRef = useRef<HTMLLIElement | null>(null);

  const activeIndex =
    currentTime == null
      ? -1
      : segments.findIndex(
          (seg, i) =>
            currentTime >= seg.start &&
            currentTime < (seg.end ?? segments[i + 1]?.start ?? Number.POSITIVE_INFINITY),
        );

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex]);
  const muletillaItems = muletillas?.items ?? [];
  const hasMuletillas = (muletillas?.total ?? 0) > 0;

  return (
    <>
      {(groups.length > 0 || hasMuletillas) && (
        <div className="mb-4 flex w-full flex-col gap-3 text-left">
          {groups.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#82918f]">
                Vocabulario técnico
              </p>
              {groups.map(([section, terms]) => (
                <div key={section}>
                  <p className="mb-1.5 text-[11px] font-semibold text-[#9ce4c1]">
                    {SECTION_LABELS[section] || section}
                  </p>
                  <ul className="flex flex-wrap gap-2">
                    {terms.map((item) => (
                      <li
                        key={`${section}-${item.term}`}
                        className="rounded-full border border-[#9ce4c1]/40 bg-[#9ce4c1]/10 px-3 py-1 text-xs font-semibold text-[#9ce4c1]"
                        title={item.category || item.lemma}
                      >
                        {item.term}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {hasMuletillas && muletillaItems.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#82918f]">
                Muletillas ({muletillas?.total ?? 0} · {muletillas?.ratioPct ?? 0}%)
              </p>
              <ul className="flex flex-wrap gap-2">
                {muletillaItems.map((item) => (
                  <li
                    key={item.phrase}
                    className="rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-300"
                  >
                    “{item.phrase}” ×{item.count}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="mb-6 max-h-64 w-full overflow-y-auto rounded-2xl border border-white/10 bg-black/20 p-4 text-left">
        {segments.length ? (
          <ul className="flex flex-col gap-1">
            {segments.map((segment, index) => {
              const isActive = index === activeIndex;
              const isPlayed = activeIndex >= 0 && index < activeIndex;
              return (
                <li
                  key={`${segment.start}-${index}`}
                  ref={isActive ? activeItemRef : undefined}
                  onClick={onSeek ? () => onSeek(segment.start) : undefined}
                  title={onSeek ? "Ir a este momento del video" : undefined}
                  className={`rounded-lg border-l-2 px-2 py-1.5 text-sm leading-relaxed transition ${
                    onSeek ? "cursor-pointer" : ""
                  } ${
                    isActive
                      ? "border-[#9ce4c1] bg-[#9ce4c1]/10"
                      : `border-transparent ${onSeek ? "hover:bg-white/5" : ""} ${isPlayed ? "opacity-60" : ""}`
                  }`}
                >
                  <span
                    className={`mr-2 font-semibold ${
                      isActive ? "text-[#9ce4c1]" : "text-[#9ce4c1]/70"
                    }`}
                  >
                    {cueClock(segment.start)}
                  </span>
                  <span className={isActive ? "text-white" : "text-[#c3cdcb]"}>
                    {highlightText(segment.text, vocabulary)}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-[#82918f]">No se detectó voz durante la grabación.</p>
        )}
      </div>
    </>
  );
}
