import { VISION_SERVICE_URL } from "@/lib/vision";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const upstream = await fetch(`${VISION_SERVICE_URL}/ready`, {
      signal: AbortSignal.timeout(5000),
    });

    const body = await upstream.json();
    return new Response(JSON.stringify(body), {
      status: upstream.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return new Response(
      JSON.stringify({ error: "Vision service unavailable." }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }
}
