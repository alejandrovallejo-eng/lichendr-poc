"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.GET = GET;
const VISION_SERVICE_URL = process.env.VISION_SERVICE_URL ?? "http://127.0.0.1:8000";
exports.dynamic = "force-dynamic";
async function GET() {
    try {
        const upstream = await fetch(`${VISION_SERVICE_URL}/health`, {
            signal: AbortSignal.timeout(5000),
        });
        const body = await upstream.json();
        return new Response(JSON.stringify(body), {
            status: upstream.status,
            headers: { "content-type": "application/json" },
        });
    }
    catch {
        return new Response(JSON.stringify({ error: "Vision service unavailable." }), { status: 503, headers: { "content-type": "application/json" } });
    }
}
