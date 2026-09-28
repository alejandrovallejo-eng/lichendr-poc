"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.default = AnnotationsPage;
const jsx_runtime_1 = require("react/jsx-runtime");
exports.dynamic = "force-dynamic";
const react_1 = require("react");
const AnnotationsEntry_1 = __importDefault(require("@/modules/annotations/AnnotationsEntry"));
function AnnotationsPage() {
    return ((0, jsx_runtime_1.jsx)(react_1.Suspense, { fallback: (0, jsx_runtime_1.jsx)("div", { className: "rounded border p-4 text-sm", style: { background: "var(--ld-card)", borderColor: "var(--ld-border)", color: "var(--ld-text-secondary)" }, children: "Cargando flujo de anotaci\u00F3n..." }), children: (0, jsx_runtime_1.jsx)(AnnotationsEntry_1.default, {}) }));
}
