"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = ModulePlaceholder;
const jsx_runtime_1 = require("react/jsx-runtime");
function ModulePlaceholder({ title }) {
    return ((0, jsx_runtime_1.jsxs)("div", { className: "p-6 rounded-lg shadow-sm border", style: { background: "var(--ld-card)", borderColor: "var(--ld-border)" }, children: [(0, jsx_runtime_1.jsx)("h2", { className: "text-xl font-semibold", style: { color: "var(--ld-text)" }, children: title }), (0, jsx_runtime_1.jsx)("p", { className: "mt-2 text-sm", style: { color: "var(--ld-text-secondary)" }, children: "Este m\u00F3dulo a\u00FAn est\u00E1 en construcci\u00F3n." })] }));
}
