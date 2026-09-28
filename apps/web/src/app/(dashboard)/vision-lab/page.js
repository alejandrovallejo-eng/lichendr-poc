"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = VisionLabPage;
const navigation_1 = require("next/navigation");
function VisionLabPage() {
    (0, navigation_1.redirect)("/annotations?tool=ai");
}
