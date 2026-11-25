import React from 'react';

interface MetricItem {
  indicator: string;
  score: number;
  feedback: string;
}

interface Props {
  metrics: MetricItem[];
}

export const PerformanceMetricsChart: React.FC<Props> = ({ metrics }) => {
  return (
    <div className="bg-slate-900 text-white p-6 rounded-xl border border-emerald-500/30 shadow-lg">
      <h3 className="text-lg font-semibold text-emerald-400 mb-4">Métricas de Desempeño Cuantitativo</h3>
      <div className="space-y-4">
        {metrics.map((item, index) => (
          <div key={index} className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="font-medium">{item.indicator}</span>
              <span className="font-bold text-emerald-300">{item.score}%</span>
            </div>
            <div className="w-full bg-slate-800 h-3 rounded-full overflow-hidden">
              <div 
                className="bg-emerald-500 h-full rounded-full transition-all duration-500" 
                style={{ width: `${item.score}%` }}
              />
            </div>
            <p className="text-xs text-slate-400">{item.feedback}</p>
          </div>
        ))}
      </div>
    </div>
  );
};