"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.default = AnalysisPage;
const jsx_runtime_1 = require("react/jsx-runtime");
exports.dynamic = "force-dynamic";
const react_1 = require("react");
const AnalysisEntry_1 = __importDefault(require("@/modules/analysis/AnalysisEntry"));
function AnalysisPage() {
    return ((0, jsx_runtime_1.jsx)(react_1.Suspense, { fallback: (0, jsx_runtime_1.jsx)("div", { className: "rounded border p-4 text-sm", style: { borderColor: "var(--ld-border)" }, children: "Cargando an\u00E1lisis\u2026" }), children: (0, jsx_runtime_1.jsx)(AnalysisEntry_1.default, {}) }));
}
