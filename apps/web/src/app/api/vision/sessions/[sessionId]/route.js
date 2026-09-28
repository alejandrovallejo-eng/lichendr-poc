"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.DELETE = DELETE;
const vision_1 = require("@/lib/vision");
exports.dynamic = "force-dynamic";
async function DELETE(_request, { params }) {
    const { sessionId } = await params;
    if (!sessionId || sessionId.length < 8 || sessionId.length > 128) {
        return new Response(JSON.stringify({ error: "Invalid session ID." }), { status: 400, headers: { "content-type": "application/json" } });
    }
    try {
        const response = await fetch(`${vision_1.VISION_SERVICE_URL}/sessions/${encodeURIComponent(sessionId)}`, {
            method: "DELETE",
            headers: { ...(0, vision_1.visionAuthHeaders)() },
            signal: AbortSignal.timeout(10_000),
        });
        const body = await response.json();
        return new Response(JSON.stringify(body), {
            status: response.status,
            headers: { "content-type": "application/json" },
        });
    }
    catch {
        return new Response(JSON.stringify({ error: "Vision service unavailable." }), { status: 503, headers: { "content-type": "application/json" } });
    }
}
