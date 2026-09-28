"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.accountNavigation = exports.advancedNavigation = exports.managementNavigation = exports.resultsNavigation = exports.primaryNavigation = void 0;
exports.primaryNavigation = [
    { label: "Inicio", path: "/" },
    { label: "Jornadas", path: "/sampling-events" },
    { label: "Captura", path: "/images" },
    { label: "Resultados", path: "/analysis", description: "Resumen vigente de jornadas y continuidad del trabajo" },
];
exports.resultsNavigation = [
    { label: "Indicador biológico relativo", path: "/environmental-quality", description: "Vista separada del resumen de jornadas" },
];
exports.managementNavigation = [
    { label: "Proyectos", path: "/projects" },
    { label: "Sitios", path: "/sites" },
    { label: "Árboles", path: "/trees" },
];
exports.advancedNavigation = [
    { label: "Anotaciones", path: "/annotations" },
    { label: "Carga avanzada", path: "/images/advanced" },
    { label: "Exportar", path: "/exports" },
];
exports.accountNavigation = [
    { label: "Mi cuenta", path: "/cuenta" },
];
