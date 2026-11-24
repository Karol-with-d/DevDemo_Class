"use client";

export type TechnicalTerm = {
  term: string;
  lemma?: string;
  category?: string;
};

export type TranscriptCue = {
  start: number;
  end?: number;
  text: string;
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
  return (
    <>
      {vocabulary.length > 0 && (
        <div className="mb-4 w-full text-left">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#82918f]">
            Vocabulario técnico
          </p>
          <ul className="flex flex-wrap gap-2">
            {vocabulary.map((item) => (
              <li
                key={item.term}
                className="rounded-full border border-[#9ce4c1]/40 bg-[#9ce4c1]/10 px-3 py-1 text-xs font-semibold text-[#9ce4c1]"
                title={item.category || item.lemma}
              >
                {item.term}
              </li>
            ))}
          </ul>
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
