"use client";

import { SessionData } from "../session/SessionForm";
import { ConsolidatedReportView } from "../reports/ConsolidatedReportView";

interface RubricViewProps {
  session: SessionData | null;
}

export function RubricView({ session }: RubricViewProps) {
  return (
    <ConsolidatedReportView
      sessionId={session?.sessionId}
      candidateName={session?.candidateName}
      evaluatorName={session?.evaluatorName}
      technology={session?.technology}
      complexity={session?.complexity}
    />
  );
}
