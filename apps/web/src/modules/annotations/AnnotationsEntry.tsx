"use client";

import { useSearchParams } from "next/navigation";
import Workflow, { type AnnotationTool } from "@/modules/annotations/Workflow";

export default function AnnotationsEntry() {
  const searchParams = useSearchParams();
  const imageId = searchParams.get("imageId");
  const requestedTool = searchParams.get("tool");
  const initialTool: AnnotationTool = requestedTool === "manual" || requestedTool === "ai" || requestedTool === "layers" ? requestedTool : "manual";
  return <Workflow initialImageId={imageId} initialTool={initialTool} />;
}
