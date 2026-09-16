"use client";

import { useSearchParams } from "next/navigation";
import AnalysisDashboard from "./AnalysisDashboard";
import FourViewTreeResults from "./FourViewTreeResults";
import GuidedResults from "../four-view/GuidedResults";

export default function AnalysisEntry() {
  const params = useSearchParams();
  const seriesId = params.get("captureSeriesId");
  if (seriesId) return <FourViewTreeResults seriesId={seriesId} />;
  if (params.get("mode") === "classic") return <><p className="mb-4 text-sm">Flujo anterior · <a href="/analysis" className="underline">Ver resultados de captura guiada</a></p><AnalysisDashboard /></>;
  return <GuidedResults filters={{ projectId: params.get("projectId") || undefined, siteId: params.get("siteId") || undefined,
    eventId: params.get("eventId") || params.get("samplingEventId") || undefined, treeSampleId: params.get("treeSampleId") || undefined }} />;
}
