import { analysisCapabilities } from "@/lib/analysis-capabilities";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export async function GET() {
  const db = await createSupabaseServerClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) return Response.json({ error: "Inicia sesión para comprobar las herramientas." }, { status: 401 });
  return Response.json(analysisCapabilities(), { headers: { "cache-control": "no-store" } });
}
