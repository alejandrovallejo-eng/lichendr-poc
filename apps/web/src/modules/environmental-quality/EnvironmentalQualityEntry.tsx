"use client";

import { useSearchParams } from "next/navigation";
import GuidedResults from "../four-view/GuidedResults";
import EnvironmentalQualityDashboard from "./EnvironmentalQualityDashboard";

export function resolveEnvironmentalQualityView(params: Pick<URLSearchParams, "get">) {
  if (params.get("mode") === "classic") return "classic";
  if (params.get("mode") === "guided") return "guided";
  if (params.get("projectId") || params.get("siteId") || params.get("eventId") || params.get("samplingEventId") || params.get("treeSampleId")) return "guided";
  return "dashboard";
}

export default function EnvironmentalQualityEntry() {
  const params = useSearchParams();
  const view = resolveEnvironmentalQualityView(params);
  if (view === "classic") return <>
    <aside className="mb-4 rounded-lg bg-amber-50 p-4 text-sm">Flujo clásico: estos conteos no incluyen las capturas guiadas.
      {" "}<a className="underline" href="/environmental-quality">Volver a resultados actuales</a></aside>
    <EnvironmentalQualityDashboard />
  </>;
  if (view === "dashboard") return <EnvironmentalQualityDashboard />;
  return <GuidedResults environmental filters={{
    projectId: params.get("projectId") || undefined, siteId: params.get("siteId") || undefined,
    eventId: params.get("eventId") || params.get("samplingEventId") || undefined,
    treeSampleId: params.get("treeSampleId") || undefined,
  }} />;
}
