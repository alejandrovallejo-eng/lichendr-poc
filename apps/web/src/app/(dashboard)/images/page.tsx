import { Suspense } from "react";
import ImagesWorkflow from "@/modules/images/Workflow";

export const dynamic = "force-dynamic";

export default function ImagesPage() {
  return (
    <Suspense fallback={<div className="rounded border p-4 text-sm" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)", color: "var(--ld-text-secondary)" }}>Cargando flujo de imágenes...</div>}>
      <ImagesWorkflow />
    </Suspense>
  );
}
