import { Suspense } from "react";
import ImagesWorkflow from "@/modules/images/Workflow";

export const dynamic = "force-dynamic";

export default function AdvancedImagesPage() {
  return (
    <Suspense fallback={<div className="rounded border p-4 text-sm">Cargando modo avanzado…</div>}>
      <ImagesWorkflow />
    </Suspense>
  );
}
