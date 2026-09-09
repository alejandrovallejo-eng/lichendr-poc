import { NextRequest } from "next/server";
import { handleSamRelease } from "@/modules/region-suggestions/server/sam-handlers";
import { samRouteDeps } from "../../_deps";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const result = await handleSamRelease(await samRouteDeps(), sessionId);
  return Response.json(result.body, { status: result.status });
}
