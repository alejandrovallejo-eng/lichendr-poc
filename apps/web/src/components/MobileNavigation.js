"use strict";
"use client";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = MobileNavigation;
const jsx_runtime_1 = require("react/jsx-runtime");
const link_1 = __importDefault(require("next/link"));
const navigation_1 = require("next/navigation");
const navigation_2 = require("@/config/navigation");
function MobileSection({ title, items, pathname }) {
    return ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-2", children: [title ? (0, jsx_runtime_1.jsx)("p", { className: "text-xs font-semibold uppercase tracking-wide", style: { color: "var(--ld-text-secondary)" }, children: title }) : null, (0, jsx_runtime_1.jsx)("div", { className: "space-y-2", children: items.map((item) => {
                    const active = pathname === item.path || (item.path !== "/" && pathname?.startsWith(item.path));
                    return ((0, jsx_runtime_1.jsxs)(link_1.default, { href: item.path, className: `block rounded-xl border px-3 py-3 text-sm ${active ? "font-semibold text-white" : ""}`, style: {
                            background: active ? "var(--ld-sidebar)" : "#fff",
                            borderColor: "var(--ld-border)",
                            color: active ? "#fff" : "var(--ld-text)",
                        }, children: [(0, jsx_runtime_1.jsx)("span", { children: item.label }), item.description ? (0, jsx_runtime_1.jsx)("span", { className: "mt-1 block text-xs", style: { color: active ? "rgba(255,255,255,0.8)" : "var(--ld-text-secondary)" }, children: item.description }) : null] }, item.path));
                }) })] }));
}
function MobileNavigation() {
    const pathname = (0, navigation_1.usePathname)();
    return ((0, jsx_runtime_1.jsxs)("div", { className: "mb-4 md:hidden", children: [(0, jsx_runtime_1.jsxs)("div", { className: "mb-3 flex gap-2", children: [(0, jsx_runtime_1.jsx)(link_1.default, { href: "/preparar-jornada", className: "inline-flex flex-1 items-center justify-center rounded-lg px-4 py-3 font-semibold text-white", style: { background: "var(--ld-sidebar)" }, children: "Nueva jornada" }), (0, jsx_runtime_1.jsx)(link_1.default, { href: "/cuenta", className: "inline-flex items-center justify-center rounded-lg border px-4 py-3 text-sm font-medium", style: { borderColor: "var(--ld-border)" }, children: "Mi cuenta" })] }), (0, jsx_runtime_1.jsxs)("details", { className: "rounded-2xl border bg-white", style: { borderColor: "var(--ld-border)" }, children: [(0, jsx_runtime_1.jsx)("summary", { className: "cursor-pointer list-none px-4 py-3 font-semibold", children: "Men\u00FA" }), (0, jsx_runtime_1.jsxs)("nav", { className: "space-y-4 px-4 pb-4", children: [(0, jsx_runtime_1.jsx)(MobileSection, { items: navigation_2.primaryNavigation, pathname: pathname }), (0, jsx_runtime_1.jsx)(MobileSection, { title: "Resultados", items: navigation_2.resultsNavigation, pathname: pathname }), (0, jsx_runtime_1.jsx)(MobileSection, { title: "Gesti\u00F3n", items: navigation_2.managementNavigation, pathname: pathname }), (0, jsx_runtime_1.jsx)(MobileSection, { title: "Herramientas avanzadas", items: navigation_2.advancedNavigation, pathname: pathname }), (0, jsx_runtime_1.jsx)(MobileSection, { title: "Cuenta", items: navigation_2.accountNavigation, pathname: pathname })] })] })] }));
}
