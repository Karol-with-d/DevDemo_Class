import React from 'react';

interface Props {
  transcript: string;
  technicalTerms: string[];
}

export const NLPVocabularyViewer: React.FC<Props> = ({ transcript, technicalTerms }) => {
  const renderHighlightedText = () => {
    let parts: React.ReactNode[] = [transcript];

    technicalTerms.forEach((term, termIndex) => {
      const next: React.ReactNode[] = [];
      parts.forEach((part, partIndex) => {
        if (typeof part !== "string") {
          next.push(part);
          return;
        }
        const regex = new RegExp(`(${term})`, "gi");
        part.split(regex).forEach((chunk, i) => {
          if (chunk.toLowerCase() === term.toLowerCase()) {
            next.push(
              <mark
                key={`term-${termIndex}-${partIndex}-${i}`}
                className="bg-emerald-500/20 text-emerald-300 px-1 py-0.5 rounded border border-emerald-500/40 font-semibold"
              >
                {chunk}
              </mark>
            );
          } else if (chunk) {
            next.push(chunk);
          }
        });
      });
      parts = next;
    });

    return parts;
  };

  return (
    <div className="bg-slate-900 text-white p-6 rounded-xl border border-emerald-500/30 shadow-lg mt-6">
      <h3 className="text-lg font-semibold text-emerald-400 mb-2">Reporte de Vocabulario Técnico (PNL)</h3>
      <p className="text-xs text-slate-400 mb-4">Transcripción de la sesión con detección automática de términos especializados.</p>
      <div className="bg-slate-950 p-4 rounded-lg text-slate-300 leading-relaxed text-sm border border-slate-800">
        {renderHighlightedText()}
      </div>
    </div>
  );
};