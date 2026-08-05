"use client";

import { useSearchParams } from "next/navigation";
import Workflow, { type AnnotationTool } from "@/modules/annotations/Workflow";
import AnnotationStudioWorkflow from "@/modules/annotations/AnnotationStudioWorkflow";

export default function AnnotationsEntry() {
  const searchParams = useSearchParams();
  const imageId = searchParams.get("imageId");
  const requestedTool = searchParams.get("tool");
  const initialTool: AnnotationTool = requestedTool === "manual" || requestedTool === "ai" || requestedTool === "layers" ? requestedTool : "manual";
  if (searchParams.get("mode") === "points") {
    return <Workflow initialImageId={imageId} initialTool="manual" />;
  }
  return <AnnotationStudioWorkflow initialImageId={imageId} initialTool={initialTool} />;
}
