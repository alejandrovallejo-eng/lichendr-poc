"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.GET = GET;
const google_server_1 = require("@/modules/auth/google-server");
async function GET(request) { return (0, google_server_1.finishGoogle)(request); }
exports.dynamic = "force-dynamic";
