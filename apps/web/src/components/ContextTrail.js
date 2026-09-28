"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = ContextTrail;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
function ContextTrail({ entries, className = "" }) {
    const visible = entries.filter((entry) => entry.value && entry.value.trim().length > 0);
    if (!visible.length)
        return null;
    return ((0, jsx_runtime_1.jsx)("p", { className: `text-sm ${className}`.trim(), style: { color: "var(--ld-text-secondary)" }, children: visible.map((entry, index) => ((0, jsx_runtime_1.jsxs)(react_1.Fragment, { children: [(0, jsx_runtime_1.jsxs)("span", { children: [(0, jsx_runtime_1.jsxs)("strong", { style: { color: "var(--ld-text)" }, children: [entry.label, ":"] }), " ", entry.value] }), index < visible.length - 1 ? (0, jsx_runtime_1.jsx)("span", { "aria-hidden": "true", children: " / " }) : null] }, entry.label))) }));
}
