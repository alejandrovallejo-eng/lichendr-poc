"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtime = exports.dynamic = void 0;
exports.DELETE = DELETE;
const sam_handlers_1 = require("@/modules/region-suggestions/server/sam-handlers");
const _deps_1 = require("../../_deps");
exports.dynamic = "force-dynamic";
exports.runtime = "nodejs";
// The signed ticket travels in a header so a DELETE keeps no body: it is an
// authorisation statement, not user content.
async function DELETE(request, { params }) {
    const { sessionId } = await params;
    const result = await (0, sam_handlers_1.handleSamRelease)(await (0, _deps_1.samRouteDeps)(), sessionId, request.headers.get("x-sam-session-ticket"));
    return Response.json(result.body, { status: result.status });
}
