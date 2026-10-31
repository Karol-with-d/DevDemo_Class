'use client';

interface FeedbackPanelProps {
  isRecording: boolean;
}

export function FeedbackPanel({ isRecording }: FeedbackPanelProps) {
  return (
    <div className="flex flex-col gap-4 bg-gray-950 p-6 rounded-xl border border-gray-800 w-full">
      <h3 className="text-lg font-semibold text-gray-200 border-b border-gray-800 pb-2">
        Panel de Métricas y Eventos (EDA)
      </h3>

      {/* Estado del WebSocket */}
      <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Bus de Eventos</span>
        <div className="flex justify-between items-center mt-1">
          <span className="text-sm font-medium text-gray-300">FastAPI WebSocket</span>
          <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${isRecording ? 'bg-green-950 text-green-400 border border-green-800' : 'bg-red-950 text-red-400 border border-red-800'}`}>
            {isRecording ? 'EN VIVO' : 'INACTIVO'}
          </span>
        </div>
      </div>

      {/* Indicador de Audio */}
      <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-gray-400">Sensor de Audio:</span>
          <span className="text-green-400 font-mono font-bold">{isRecording ? '85%' : '0%'}</span>
        </div>
        <div className="w-full bg-gray-800 h-2.5 rounded-full overflow-hidden">
          <div
            className="bg-green-500 h-2.5 transition-all duration-300"
            style={{ width: isRecording ? '85%' : '0%' }}
          />
        </div>
      </div>

      {/* Eventos y alertas */}
      <div className="flex-1 bg-gray-900 p-4 rounded-lg border border-gray-800 flex flex-col justify-between">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 block">
          Alertas de Retroalimentación
        </span>
        <div className="text-xs space-y-2 font-mono">
          <p className="text-gray-300">[14:32:01] Sensor Audio: Tono de voz estable.</p>
          <p className="text-gray-300">[14:32:05] Evento EDA: Postura corporal adecuada.</p>
        </div>
      </div>
    </div>
  );
}