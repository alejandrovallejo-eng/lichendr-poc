import { NextRequest } from "next/server";
import { VISION_SERVICE_URL, visionAuthHeaders } from "@/lib/vision";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  if (!sessionId || sessionId.length < 8 || sessionId.length > 128) {
    return new Response(
      JSON.stringify({ error: "Invalid session ID." }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  try {
    const response = await fetch(`${VISION_SERVICE_URL}/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      headers: { ...visionAuthHeaders() },
      signal: AbortSignal.timeout(10_000),
    });

    const body = await response.json();
    return new Response(JSON.stringify(body), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return new Response(
      JSON.stringify({ error: "Vision service unavailable." }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }
}
