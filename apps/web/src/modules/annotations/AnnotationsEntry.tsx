"use client";

import { useSearchParams } from "next/navigation";
import AiLayersWorkflow from "@/modules/annotations/AiLayersWorkflow";
import Workflow from "@/modules/annotations/Workflow";

export default function AnnotationsEntry() {
  const searchParams = useSearchParams();
  const imageId = searchParams.get("imageId");
  const annotationSetId = searchParams.get("annotationSetId");
  if (imageId && annotationSetId) return <AiLayersWorkflow imageId={imageId} annotationSetId={annotationSetId} />;
  return <Workflow />;
}
