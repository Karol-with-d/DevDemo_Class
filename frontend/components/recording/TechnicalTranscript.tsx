"use client";

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

function highlightText(text: string, terms: TechnicalTerm[]) {
  const unique = [
    ...new Set(
      terms.flatMap((item) => [item.term, item.lemma || ""]).filter((value) => value.length > 1),
    ),
  ].sort((a, b) => b.length - a.length);
  if (!unique.length) return text;

  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(${unique.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}_])`,
    "giu",
  );
  const parts = text.split(pattern);
  return parts.map((part, index) => {
    const isHit = unique.some((term) => term.toLowerCase() === part.toLowerCase());
    if (!isHit) return <span key={`${part}-${index}`}>{part}</span>;
    return (
      <mark
        key={`${part}-${index}`}
        className="rounded-sm bg-[#9ce4c1]/25 px-0.5 font-semibold text-[#9ce4c1]"
      >
        {part}
      </mark>
    );
  });
}

export function TechnicalTranscript({
  segments,
  vocabulary,
}: {
  segments: TranscriptCue[];
  vocabulary: TechnicalTerm[];
}) {
  const groups = groupBySection(vocabulary);

  return (
    <>
      {groups.length > 0 && (
        <div className="mb-4 w-full space-y-3 text-left">
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
      <div className="mb-6 max-h-64 w-full overflow-y-auto rounded-2xl border border-white/10 bg-black/20 p-4 text-left">
        {segments.length ? (
          <ul className="flex flex-col gap-3">
            {segments.map((segment) => (
              <li key={`${segment.start}-${segment.text}`} className="text-sm">
                <span className="mr-2 font-semibold text-[#9ce4c1]">{cueClock(segment.start)}</span>
                <span>{highlightText(segment.text, vocabulary)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[#82918f]">No se detectó voz durante la grabación.</p>
        )}
      </div>
    </>
  );
}
