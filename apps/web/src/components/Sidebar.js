"use strict";
"use client";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Sidebar;
const jsx_runtime_1 = require("react/jsx-runtime");
const link_1 = __importDefault(require("next/link"));
const navigation_1 = require("next/navigation");
const navigation_2 = require("@/config/navigation");
function NavSection({ title, items, pathname }) {
    return ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-1", children: [title ? (0, jsx_runtime_1.jsx)("p", { className: "px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-white/60", children: title }) : null, items.map((item) => {
                const active = pathname === item.path || (item.path !== "/" && pathname?.startsWith(item.path));
                return ((0, jsx_runtime_1.jsxs)(link_1.default, { href: item.path, className: `block rounded-xl px-3 py-2 transition-colors ${active ? "bg-[#225447] text-white" : "text-white/90 hover:bg-[#225447]"}`, "aria-current": active ? "page" : undefined, children: [(0, jsx_runtime_1.jsx)("span", { className: active ? "border-l-4 border-[#D9BD67] pl-2" : "pl-2", children: item.label }), item.description ? (0, jsx_runtime_1.jsx)("span", { className: "mt-1 block pl-2 text-xs text-white/70", children: item.description }) : null] }, item.path));
            })] }));
}
function Sidebar() {
    const pathname = (0, navigation_1.usePathname)();
    return ((0, jsx_runtime_1.jsxs)("aside", { className: "w-64 hidden md:block p-4", style: { background: "var(--ld-sidebar)" }, children: [(0, jsx_runtime_1.jsx)("div", { className: "mb-6 font-semibold text-white", children: "LichenDR" }), (0, jsx_runtime_1.jsx)(link_1.default, { href: "/preparar-jornada", className: "mb-4 inline-flex w-full items-center justify-center rounded-xl px-4 py-3 font-semibold text-white", style: { background: "var(--ld-green)" }, children: "Nueva jornada" }), (0, jsx_runtime_1.jsxs)("nav", { className: "flex flex-col gap-3", children: [(0, jsx_runtime_1.jsx)(NavSection, { items: navigation_2.primaryNavigation, pathname: pathname }), (0, jsx_runtime_1.jsx)(NavSection, { title: "Resultados", items: navigation_2.resultsNavigation, pathname: pathname }), (0, jsx_runtime_1.jsx)(NavSection, { title: "Gesti\u00F3n", items: navigation_2.managementNavigation, pathname: pathname }), (0, jsx_runtime_1.jsx)(NavSection, { title: "Herramientas avanzadas", items: navigation_2.advancedNavigation, pathname: pathname }), (0, jsx_runtime_1.jsx)(NavSection, { title: "Cuenta", items: navigation_2.accountNavigation, pathname: pathname })] })] }));
}
