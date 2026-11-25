"use client";

import { SessionData } from "../session/SessionForm";
import { ConsolidatedReportView } from "../reports/ConsolidatedReportView";

interface RubricViewProps {
  session: SessionData | null;
}

export function RubricView({ session }: RubricViewProps) {
  return (
    <div className="rounded-2xl border border-[rgba(194,220,213,0.12)] bg-[#11191e] p-2 sm:p-4 shadow-xl">
      <ConsolidatedReportView
        sessionId={session?.sessionId || "SES-DEMO-01"}
        candidateName={session?.candidateName || "Candidato"}
        evaluatorName={session?.evaluatorName || ""}
        technology={session?.technology || ""}
        complexity={session?.complexity || ""}
      />
    </div>
  );
}