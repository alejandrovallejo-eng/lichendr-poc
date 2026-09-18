import { NextRequest } from "next/server";
import { finishGoogle } from "@/modules/auth/google-server";
export async function GET(request: NextRequest) { return finishGoogle(request); }
export const dynamic = "force-dynamic";
