import { NextRequest } from "next/server";
import { handleSamRelease } from "@/modules/region-suggestions/server/sam-handlers";
import { samRouteDeps } from "../../_deps";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The signed ticket travels in a header so a DELETE keeps no body: it is an
// authorisation statement, not user content.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const result = await handleSamRelease(
    await samRouteDeps(),
    sessionId,
    request.headers.get("x-sam-session-ticket"),
  );
  return Response.json(result.body, { status: result.status });
}
