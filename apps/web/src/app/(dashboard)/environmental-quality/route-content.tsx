import { Suspense } from "react";
import EnvironmentalQualityEntry from "@/modules/environmental-quality/EnvironmentalQualityEntry";

export const dynamic = "force-dynamic";

export default function EnvironmentalQualityPage() {
  return (
    <Suspense fallback={<div role="status" className="rounded border p-4 text-sm" style={{ borderColor: "var(--ld-border)" }}>Cargando resultados de la jornada…</div>}>
      <EnvironmentalQualityEntry />
    </Suspense>
  );
}
