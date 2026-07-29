import { Suspense } from "react";
import Workflow from "@/modules/annotations/Workflow";

export default function AnnotationsPage() {
  return (
    <Suspense fallback={<div className="rounded border p-4 text-sm" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)", color: "var(--ld-text-secondary)" }}>Cargando flujo de anotación...</div>}>
      <Workflow />
    </Suspense>
  );
}
