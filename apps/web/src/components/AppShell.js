"use strict";
"use client";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = AppShell;
const jsx_runtime_1 = require("react/jsx-runtime");
const link_1 = __importDefault(require("next/link"));
const Sidebar_1 = __importDefault(require("./Sidebar"));
const MobileNavigation_1 = __importDefault(require("./MobileNavigation"));
function AppShell({ children }) {
    return ((0, jsx_runtime_1.jsx)("div", { className: "min-h-screen w-full", style: { background: "var(--ld-background)" }, children: (0, jsx_runtime_1.jsxs)("div", { className: "max-w-7xl mx-auto flex min-h-screen", children: [(0, jsx_runtime_1.jsx)(Sidebar_1.default, {}), (0, jsx_runtime_1.jsxs)("main", { className: "flex-1 p-6 min-w-0", style: { color: "var(--ld-text)" }, children: [(0, jsx_runtime_1.jsx)("div", { className: "mb-3 hidden justify-end md:flex", children: (0, jsx_runtime_1.jsx)(link_1.default, { href: "/cuenta", className: "rounded-lg border border-emerald-200 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50", children: "Mi cuenta" }) }), (0, jsx_runtime_1.jsx)(MobileNavigation_1.default, {}), (0, jsx_runtime_1.jsx)("div", { className: "mt-4", children: children })] })] }) }));
}
