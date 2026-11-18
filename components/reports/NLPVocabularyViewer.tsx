import React from 'react';

interface Props {
  transcript: string;
  technicalTerms: string[];
}

export const NLPVocabularyViewer: React.FC<Props> = ({ transcript, technicalTerms }) => {
  const renderHighlightedText = () => {
    let parts: (string | React.ReactNode)[] = [transcript];
    
    technicalTerms.forEach((term, termIndex) => {
      parts = parts.flatMap((part, partIndex) => {
        if (typeof part !== 'string') return part;
        const regex = new RegExp(`(${term})`, 'gi');
        return part.split(regex).map((chunk, i) => 
          chunk.toLowerCase() === term.toLowerCase() ? (
            <mark key={`term-${termIndex}-${partIndex}-${i}`} className="bg-emerald-500/20 text-emerald-300 px-1 py-0.5 rounded border border-emerald-500/40 font-semibold">
              {chunk}
            </mark>
          ) : chunk
        );
      });
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