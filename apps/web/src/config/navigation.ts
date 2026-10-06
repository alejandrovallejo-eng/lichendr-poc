export type NavItem = {
  label: string;
  path: string;
  description?: string;
};

export const primaryNavigation: NavItem[] = [
  { label: "Inicio", path: "/" },
  { label: "Jornadas", path: "/sampling-events" },
  { label: "Captura", path: "/images" },
  { label: "Resultados", path: "/analysis", description: "Resumen vigente de jornadas y continuidad del trabajo" },
];

export const resultsNavigation: NavItem[] = [
  { label: "Indicador biológico relativo", path: "/environmental-quality", description: "Vista separada del resumen de jornadas" },
];

export const managementNavigation: NavItem[] = [
  { label: "Proyectos", path: "/projects" },
  { label: "Sitios", path: "/sites" },
  { label: "Árboles", path: "/trees" },
];

export const advancedNavigation: NavItem[] = [
  { label: "Anotaciones", path: "/annotations" },
  { label: "Carga avanzada", path: "/images/advanced" },
  { label: "Exportar", path: "/exports" },
];

export const accountNavigation: NavItem[] = [
  { label: "Mi cuenta", path: "/cuenta" },
];
