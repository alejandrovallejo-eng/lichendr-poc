"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtime = exports.dynamic = void 0;
exports.POST = POST;
const sam_handlers_1 = require("@/modules/region-suggestions/server/sam-handlers");
const _deps_1 = require("../_deps");
exports.dynamic = "force-dynamic";
exports.runtime = "nodejs";
// Prepares a MobileSAM session from the PRIVATE ANALYSIS PROXY of an authorised
// view. The browser sends a small reference, never the original photograph.
async function POST(request) {
    const result = await (0, sam_handlers_1.handleSamPrepare)(await (0, _deps_1.samRouteDeps)(), request);
    return Response.json(result.body, { status: result.status });
}
