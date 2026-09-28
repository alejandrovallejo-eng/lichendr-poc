"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.POST = POST;
const vision_1 = require("@/lib/vision");
exports.dynamic = "force-dynamic";
function isValidSegmentBody(body) {
    if (typeof body !== "object" || body === null)
        return false;
    const b = body;
    if (typeof b.sessionId !== "string" || b.sessionId.length < 8 || b.sessionId.length > 128)
        return false;
    if (!Array.isArray(b.points) || b.points.length === 0 || b.points.length > 64)
        return false;
    for (const p of b.points) {
        if (typeof p !== "object" || p === null)
            return false;
        const pt = p;
        if (typeof pt.x !== "number" || pt.x < 0 || pt.x > 1)
            return false;
        if (typeof pt.y !== "number" || pt.y < 0 || pt.y > 1)
            return false;
        if (pt.label !== 0 && pt.label !== 1)
            return false;
    }
    return true;
}
async function POST(request) {
    let body;
    try {
        body = await request.json();
    }
    catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body." }), { status: 400, headers: { "content-type": "application/json" } });
    }
    if (!isValidSegmentBody(body)) {
        return new Response(JSON.stringify({ error: "Invalid request body." }), { status: 400, headers: { "content-type": "application/json" } });
    }
    try {
        const response = await fetch(`${vision_1.VISION_SERVICE_URL}/segment`, {
            method: "POST",
            headers: { "content-type": "application/json", ...(0, vision_1.visionAuthHeaders)() },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60_000),
        });
        const result = await response.json();
        return new Response(JSON.stringify(result), {
            status: response.status,
            headers: { "content-type": "application/json" },
        });
    }
    catch {
        return new Response(JSON.stringify({ error: "Vision service unavailable." }), { status: 503, headers: { "content-type": "application/json" } });
    }
}
