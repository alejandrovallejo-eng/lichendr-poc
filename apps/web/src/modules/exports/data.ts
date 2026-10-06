import type { SupabaseClient } from "@supabase/supabase-js";
import { DATABASE_TABLES } from "../../lib/supabase/readiness.mjs";
export type ExportRow = Record<string, unknown>;
export interface DataExport {
  schemaVersion: 1; generatedAt: string; ownerId: string;
  scope: "current_user"; scientificNotice: string;
  tables: Record<string, ExportRow[]>;
}
export class ExportLimitError extends Error {}
export const SCIENTIFIC_NOTICE = "Cobertura descriptiva por vista. Las sugerencias de IA requieren revisión; no confirman especies ni calidad del aire.";
/** RLS applies to every paginated read. No service-role key or model calls. */
export async function readDataExport(db: SupabaseClient, signal?: AbortSignal): Promise<DataExport> {
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) throw new Error("Inicia sesión para descargar tus datos.");
  const ownerId = data.user.id;
  const tables: Record<string, ExportRow[]> = {};
  let bytes = 0;
  const names = Object.keys(DATABASE_TABLES);
  for (let i = 0; i < names.length; i += 4) await Promise.all(names.slice(i, i + 4).map(async name => {
    const rows: ExportRow[] = [];
    const keys = name === "site_environmental_contexts" ? ["site_id", "sampling_event_id"]
      : name === "guided_capture_reviews" ? ["owner_id", "image_id", "tree_sample_id", "direction"]
      : name === "ecological_quadrat_reviews" ? ["owner_id", "image_id", "tree_sample_id", "direction"]
      : [DATABASE_TABLES[name as keyof typeof DATABASE_TABLES].split(",")[0]];
    for (let page = 0; page < 100; page++) {
      signal?.throwIfAborted();
      let query = db.from(name).select("*");
      for (const key of keys) query = query.order(key, { nullsFirst: false });
      query = query.range(page * 200, (page + 1) * 200 - 1);
      if (name === "projects" || name === "guided_capture_reviews") query = query.eq("owner_id", ownerId);
      if (signal) query = query.abortSignal(signal);
      const result = await query;
      if (result.error || !result.data) throw new Error(`No se pudo descargar ${name}. Reintenta; no se generó una copia parcial.`);
      bytes += new TextEncoder().encode(JSON.stringify(result.data)).length;
      if (bytes > 3 * 1024 * 1024) throw new ExportLimitError("Esta descarga supera el límite seguro de registros. Usa un respaldo administrativo paginado.");
      rows.push(...result.data);
      if (result.data.length < 200) { tables[name] = rows; return; }
    }
    throw new Error("La descarga supera el límite de registros. Usa un respaldo administrativo paginado.");
  }));
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), ownerId, scope: "current_user", scientificNotice: SCIENTIFIC_NOTICE, tables };
}
/** Quote every cell and neutralize spreadsheet formula execution. */
export function csv(rows: readonly ExportRow[], columns: readonly string[]) {
  const cell = (value: unknown) => {
    let text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    if (typeof value === "string" && /^[\s]*[=+@-]/u.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return "\uFEFF" + [columns.map(cell).join(","), ...rows.map(row => columns.map(column => cell(row[column])).join(","))].join("\r\n") + "\r\n";
}
