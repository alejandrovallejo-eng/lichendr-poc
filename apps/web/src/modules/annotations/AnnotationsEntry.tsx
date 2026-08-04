"use client";

import { useSearchParams } from "next/navigation";
import Workflow from "@/modules/annotations/Workflow";

export default function AnnotationsEntry() {
  const searchParams = useSearchParams();
  const imageId = searchParams.get("imageId");
  return <Workflow initialImageId={imageId} />;
}
