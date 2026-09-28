"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = MetricCard;
const jsx_runtime_1 = require("react/jsx-runtime");
function MetricCard({ label, value }) {
    return ((0, jsx_runtime_1.jsxs)("div", { className: "p-4 rounded-lg shadow-sm border flex flex-col items-start", style: { background: "var(--ld-card)", borderColor: "var(--ld-border)" }, children: [(0, jsx_runtime_1.jsx)("div", { className: "text-2xl font-bold", style: { color: "var(--ld-text)" }, children: value }), (0, jsx_runtime_1.jsx)("div", { className: "text-sm", style: { color: "var(--ld-text-secondary)" }, children: label })] }));
}
