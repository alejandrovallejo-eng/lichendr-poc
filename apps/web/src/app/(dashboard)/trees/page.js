"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.default = TreesPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const Workflow_1 = __importDefault(require("@/modules/trees/Workflow"));
exports.dynamic = "force-dynamic";
function TreesPage() {
    return (0, jsx_runtime_1.jsx)(Workflow_1.default, {});
}
