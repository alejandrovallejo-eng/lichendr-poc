"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = PageHeader;
const jsx_runtime_1 = require("react/jsx-runtime");
function PageHeader({ title, subtitle }) {
    return ((0, jsx_runtime_1.jsxs)("header", { className: "mb-6", children: [(0, jsx_runtime_1.jsx)("h1", { className: "text-3xl font-semibold", style: { color: "var(--ld-text)" }, children: title }), subtitle && (0, jsx_runtime_1.jsx)("p", { className: "text-sm", style: { color: "var(--ld-text-secondary)" }, children: subtitle })] }));
}
