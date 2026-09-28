"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.default = AccountPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const AccountPanel_1 = __importDefault(require("@/modules/auth/AccountPanel"));
exports.dynamic = "force-dynamic";
function AccountPage() { return (0, jsx_runtime_1.jsx)(AccountPanel_1.default, {}); }
