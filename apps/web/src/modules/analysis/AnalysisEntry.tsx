"use client";

import { useSearchParams } from "next/navigation";
import AnalysisDashboard from "./AnalysisDashboard";
import FourViewTreeResults from "./FourViewTreeResults";

export default function AnalysisEntry() {
  const seriesId = useSearchParams().get("captureSeriesId");
  return seriesId ? <FourViewTreeResults seriesId={seriesId} /> : <AnalysisDashboard />;
}
