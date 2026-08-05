import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return new Response(
      JSON.stringify({ error: "Supabase environment not configured" }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      }
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("projects")
    .select("id", { count: "exact", head: true });

  if (error) {
    return new Response(
      JSON.stringify({ error: "Supabase did not respond successfully" }),
      {
        status: 502,
        headers: { "content-type": "application/json" },
      }
    );
  }

  return new Response(JSON.stringify({ status: "ok", supabase: "reachable" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
