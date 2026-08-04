import VisionLab from "@/modules/vision-lab/VisionLab";
import { Suspense } from "react";

export default function VisionLabPage() {
  return <Suspense fallback={<div className="rounded border p-4 text-sm">Cargando Laboratorio IA…</div>}><VisionLab /></Suspense>;
}
