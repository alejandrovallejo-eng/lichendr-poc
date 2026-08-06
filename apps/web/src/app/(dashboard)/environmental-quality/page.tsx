import { Suspense } from "react";
import EnvironmentalQualityDashboard from "@/modules/environmental-quality/EnvironmentalQualityDashboard";

export const dynamic = "force-dynamic";

export default function EnvironmentalQualityPage() {
  return (
    <Suspense fallback={<div className="rounded border p-4 text-sm" style={{ borderColor: "var(--ld-border)" }}>Cargando preparación científica…</div>}>
      <EnvironmentalQualityDashboard />
    </Suspense>
  );
}
