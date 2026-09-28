"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.default = ImagesPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const Workflow_1 = __importDefault(require("@/modules/four-view/Workflow"));
exports.dynamic = "force-dynamic";
function ImagesPage() {
    return ((0, jsx_runtime_1.jsx)(react_1.Suspense, { fallback: (0, jsx_runtime_1.jsx)("div", { className: "rounded border p-4 text-sm", style: { background: "var(--ld-card)", borderColor: "var(--ld-border)", color: "var(--ld-text-secondary)" }, children: "Cargando flujo de im\u00E1genes..." }), children: (0, jsx_runtime_1.jsx)(Workflow_1.default, {}) }));
}
