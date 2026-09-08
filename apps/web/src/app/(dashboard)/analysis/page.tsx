export const dynamic = "force-dynamic";
import { Suspense } from "react";
import AnalysisEntry from "@/modules/analysis/AnalysisEntry";

export default function AnalysisPage() {
  return (
    <Suspense fallback={<div className="rounded border p-4 text-sm" style={{ borderColor: "var(--ld-border)" }}>Cargando análisis…</div>}>
      <AnalysisEntry />
    </Suspense>
  );
}
