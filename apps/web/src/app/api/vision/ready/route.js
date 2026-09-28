"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.GET = GET;
const vision_1 = require("@/lib/vision");
exports.dynamic = "force-dynamic";
async function GET() {
    try {
        const upstream = await fetch(`${vision_1.VISION_SERVICE_URL}/ready`, {
            cache: "no-store",
            signal: AbortSignal.timeout(5000),
        });
        const body = await upstream.json();
        return new Response(JSON.stringify(body), {
            status: upstream.status,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
    }
    catch {
        return new Response(JSON.stringify({ error: "Vision service unavailable." }), { status: 503, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }
}
