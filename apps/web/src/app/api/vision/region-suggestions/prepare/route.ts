import { NextRequest } from "next/server";
import { handleSamPrepare } from "@/modules/region-suggestions/server/sam-handlers";
import { samRouteDeps } from "../_deps";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Prepares a MobileSAM session from the PRIVATE ANALYSIS PROXY of an authorised
// view. The browser sends a small reference, never the original photograph.
export async function POST(request: NextRequest) {
  const result = await handleSamPrepare(await samRouteDeps(), request);
  return Response.json(result.body, { status: result.status });
}
