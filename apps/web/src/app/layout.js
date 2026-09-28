"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.metadata = void 0;
exports.default = RootLayout;
const jsx_runtime_1 = require("react/jsx-runtime");
const local_1 = __importDefault(require("next/font/local"));
require("./globals.css");
const geistSans = (0, local_1.default)({
    src: "../../public/fonts/geist-sans.woff2",
    variable: "--font-geist-sans",
    display: "swap",
});
const geistMono = (0, local_1.default)({
    src: "../../public/fonts/geist-mono.woff2",
    variable: "--font-geist-mono",
    display: "swap",
});
exports.metadata = {
    title: "LichenDR",
    description: "Interfaz modular para biomonitoreo de líquenes",
};
function RootLayout({ children, }) {
    return ((0, jsx_runtime_1.jsx)("html", { lang: "es", className: `${geistSans.variable} ${geistMono.variable} h-full antialiased`, children: (0, jsx_runtime_1.jsx)("body", { className: "min-h-full flex flex-col", style: { background: "var(--ld-background)", color: "var(--ld-text)" }, children: children }) }));
}
