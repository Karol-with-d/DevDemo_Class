import React from "react";

interface Props {
  transcript: string;
  technicalTerms: string[];
}

export const NLPVocabularyViewer: React.FC<Props> = ({ transcript, technicalTerms }) => {
  const renderHighlightedText = () => {
    let parts: (string | React.ReactNode)[] = [transcript];

    technicalTerms.forEach((term, termIndex) => {
      parts = parts.flatMap((part, partIndex) => {
        if (typeof part !== "string") return part;
        const regex = new RegExp(`(${term})`, "gi");
        return part.split(regex).map((chunk, i) =>
          chunk.toLowerCase() === term.toLowerCase() ? (
            <mark
              key={`term-${termIndex}-${partIndex}-${i}`}
              className="rounded border border-emerald-500/40 bg-emerald-500/20 px-1 py-0.5 font-semibold text-emerald-300"
            >
              {chunk}
            </mark>
          ) : (
            chunk
          )
        );
      });
    });

    return parts;
  };

  return (
    <div className="mt-6 rounded-xl border border-emerald-500/30 bg-slate-900 p-6 text-white shadow-lg">
      <h3 className="mb-2 text-lg font-semibold text-emerald-400">
        Vocabulario Técnico Detectado
      </h3>
      <p className="mb-4 text-xs text-slate-400">
        Transcripción de la sesión con detección automática de palabras clave técnicas.
      </p>
      <div className="rounded-lg border border-slate-800 bg-slate-950 p-4 text-sm leading-relaxed text-slate-300">
        {renderHighlightedText()}
      </div>
    </div>
  );
};