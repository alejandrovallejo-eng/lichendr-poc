import { Suspense } from "react";
import EnvironmentalQualityDashboard from "@/modules/environmental-quality/EnvironmentalQualityDashboard";

export const dynamic = "force-dynamic";

export default function EnvironmentalQualityPage() {
  return (
    <><aside className="mb-5 rounded-lg border bg-emerald-50 p-4 text-sm">
      <p>Los análisis de la captura guiada están en <a href="/analysis" className="font-semibold underline">Resultados por jornada</a>, con las cuatro vistas de cada árbol.</p>
      <p className="mt-1">Este módulo científico conserva las evaluaciones del flujo clásico por separado. Sus conteos no incluyen la captura guiada; cobertura por colores no equivale a calidad del aire.</p>
    </aside><Suspense fallback={<div className="rounded border p-4 text-sm" style={{ borderColor: "var(--ld-border)" }}>Cargando preparación científica…</div>}>
      <EnvironmentalQualityDashboard />
    </Suspense></>
  );
}
