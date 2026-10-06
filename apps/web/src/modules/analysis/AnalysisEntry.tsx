"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import GuidedResults from "../four-view/GuidedResults";
const AnalysisDashboard = dynamic(() => import("./AnalysisDashboard"), {
  loading: () => <p role="status">Cargando el espacio de trabajo…</p>,
});
const FourViewTreeResults = dynamic(() => import("./FourViewTreeResults"), {
  loading: () => <p role="status">Cargando el espacio de trabajo…</p>,
});
const EcologyJourney = dynamic(() => import("../four-view/EcologyJourney"), {
  loading: () => <p role="status">Cargando el espacio de trabajo…</p>,
});

export default function AnalysisEntry() {
  const params = useSearchParams();
  const seriesId = params.get("captureSeriesId");
  if (params.get("mode") === "ecology")
    return (
      <EcologyJourney
        eventId={params.get("eventId") || undefined}
        initialSampleId={params.get("treeSampleId") || undefined}
      />
    );
  if (seriesId) return <FourViewTreeResults seriesId={seriesId} />;
  if (params.get("mode") === "classic")
    return (
      <>
        <p className="mb-4 text-sm">
          Flujo anterior ·{" "}
          <a href="/analysis" className="underline">
            Ver resultados de captura guiada
          </a>
        </p>
        <AnalysisDashboard />
      </>
    );
  return (
    <GuidedResults
      filters={{
        projectId: params.get("projectId") || undefined,
        siteId: params.get("siteId") || undefined,
        eventId:
          params.get("eventId") || params.get("samplingEventId") || undefined,
        treeSampleId: params.get("treeSampleId") || undefined,
      }}
    />
  );
}
