"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import type { AnnotationTool } from "@/modules/annotations/Workflow";
const Workflow = dynamic(() => import("@/modules/annotations/Workflow"), {
  loading: () => <p role="status">Cargando el espacio de trabajo…</p>,
});
const AnnotationStudioWorkflow = dynamic(
  () => import("@/modules/annotations/AnnotationStudioWorkflow"),
  { loading: () => <p role="status">Cargando el espacio de trabajo…</p> },
);
const FourViewAnnotationWorkspace = dynamic(
  () => import("@/modules/annotations/FourViewAnnotationWorkspace"),
  { loading: () => <p role="status">Cargando el espacio de trabajo…</p> },
);

export default function AnnotationsEntry() {
  const searchParams = useSearchParams();
  const imageId = searchParams.get("imageId");
  const requestedTool = searchParams.get("tool");
  const captureSeriesId = searchParams.get("captureSeriesId");
  if (captureSeriesId)
    return <FourViewAnnotationWorkspace seriesId={captureSeriesId} />;
  const initialTool: AnnotationTool =
    requestedTool === "manual" ||
    requestedTool === "ai" ||
    requestedTool === "layers"
      ? requestedTool
      : "manual";
  if (searchParams.get("mode") === "points") {
    return <Workflow initialImageId={imageId} initialTool="manual" />;
  }
  return (
    <AnnotationStudioWorkflow
      initialImageId={imageId}
      initialTool={initialTool}
    />
  );
}
