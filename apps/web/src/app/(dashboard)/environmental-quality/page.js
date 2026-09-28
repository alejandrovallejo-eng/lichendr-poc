"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.default = EnvironmentalQualityPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const EnvironmentalQualityEntry_1 = __importDefault(require("@/modules/environmental-quality/EnvironmentalQualityEntry"));
exports.dynamic = "force-dynamic";
function EnvironmentalQualityPage() {
    return ((0, jsx_runtime_1.jsx)(react_1.Suspense, { fallback: (0, jsx_runtime_1.jsx)("div", { role: "status", className: "rounded border p-4 text-sm", style: { borderColor: "var(--ld-border)" }, children: "Cargando resultados de la jornada\u2026" }), children: (0, jsx_runtime_1.jsx)(EnvironmentalQualityEntry_1.default, {}) }));
}
