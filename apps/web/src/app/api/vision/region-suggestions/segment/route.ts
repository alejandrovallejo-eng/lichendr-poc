import { NextRequest } from "next/server";
import { handleSamSegment } from "@/modules/region-suggestions/server/sam-handlers";
import { samRouteDeps } from "../_deps";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const result = await handleSamSegment(await samRouteDeps(), request);
  return Response.json(result.body, { status: result.status });
}
