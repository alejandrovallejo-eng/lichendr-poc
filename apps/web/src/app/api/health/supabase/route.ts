import { createSupabaseServerClient } from "@/lib/supabase/server";
import { checkSupabaseConnection } from "@/lib/supabase/readiness.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return new Response(
      JSON.stringify({ error: "Supabase environment not configured" }),
      {
        status: 500,
        headers: { "content-type": "application/json", "Cache-Control": "private, no-store" },
      }
    );
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getSession();
    const result = await checkSupabaseConnection({
      url: supabaseUrl,
      key: supabaseKey,
      accessToken: data.session?.access_token,
    });
    return Response.json(result, {
      status: result.status === "unavailable" ? 502 : result.status === "degraded" ? 503 : 200,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json({ status: "unavailable", error: "Supabase check failed" }, {
      status: 502, headers: { "Cache-Control": "private, no-store" },
    });
  }
}
