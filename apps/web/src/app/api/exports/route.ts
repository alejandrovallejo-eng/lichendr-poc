import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readDataExport, csv, ExportLimitError } from "@/modules/exports/data";
import { viewExportRows, VIEW_COLUMNS } from "@/modules/exports/views";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const datasets = ["views", "pollutant_measurements", "site_environmental_contexts", "tree_sample_scientific_contexts", "annotation_metrics"];
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const format = params.get("format") ?? "json", dataset = params.get("dataset") ?? "views";
  if (!["json", "csv"].includes(format) || !datasets.includes(dataset)) return Response.json({ error: "Formato o conjunto de datos inválido." }, { status: 400 });
  const db = await createSupabaseServerClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) return Response.json({ error: "Inicia sesión para descargar tus datos." }, { status: 401 });
  try {
    const snapshot = await readDataExport(db, AbortSignal.any([request.signal, AbortSignal.timeout(50_000)]));
    const rows = dataset === "views" ? viewExportRows(snapshot) : snapshot.tables[dataset];
    const body = format === "json" ? JSON.stringify(snapshot, null, 2) : csv(rows,
      dataset === "views" ? VIEW_COLUMNS : [...new Set(rows.flatMap(row => Object.keys(row)))].sort());
    if (Buffer.byteLength(body) > 3_500_000) return Response.json({ error: "La descarga es demasiado grande para esta ruta. Usa un respaldo administrativo paginado." }, { status: 413 });
    return new Response(body, { headers: { "content-type": format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="lichendr-${format === "json" ? "datos" : dataset}-${snapshot.generatedAt.slice(0, 10)}.${format}"`,
      "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    if (error instanceof ExportLimitError) return Response.json({ error: error.message }, { status: 413 });
    return Response.json({ error: "No se pudo completar la descarga. No se generó una copia parcial; reintenta." }, { status: 503 });
  }
}
