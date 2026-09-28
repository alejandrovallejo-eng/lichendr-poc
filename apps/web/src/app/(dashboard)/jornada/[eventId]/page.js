"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.metadata = exports.dynamic = void 0;
exports.default = JornadaPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const Workflow_1 = __importDefault(require("@/modules/jornada/Workflow"));
exports.dynamic = "force-dynamic";
exports.metadata = {
    title: "Árboles de la jornada · LichenDR",
};
async function JornadaPage({ params, }) {
    const { eventId } = await params;
    return (0, jsx_runtime_1.jsx)(Workflow_1.default, { eventId: eventId });
}
