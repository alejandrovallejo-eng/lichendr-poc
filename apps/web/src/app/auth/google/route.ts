import { NextRequest } from "next/server";
import { startGoogle } from "@/modules/auth/google-server";
export async function POST(request: NextRequest) { return startGoogle(request); }
export const dynamic = "force-dynamic";
