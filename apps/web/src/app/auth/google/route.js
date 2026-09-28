"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.POST = POST;
const google_server_1 = require("@/modules/auth/google-server");
async function POST(request) { return (0, google_server_1.startGoogle)(request); }
exports.dynamic = "force-dynamic";
