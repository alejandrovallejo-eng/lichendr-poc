"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.metadata = void 0;
exports.default = DashboardLayout;
const jsx_runtime_1 = require("react/jsx-runtime");
const AppShell_1 = __importDefault(require("@/components/AppShell"));
exports.metadata = {
    title: "LichenDR - Panel",
};
function DashboardLayout({ children }) {
    return ((0, jsx_runtime_1.jsx)(AppShell_1.default, { children: children }));
}
