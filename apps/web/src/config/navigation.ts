export type NavItem = {
  label: string;
  path: string;
};

export const navigation: NavItem[] = [
  { label: "Panel", path: "/" },
  { label: "Preparar jornada", path: "/preparar-jornada" },
  { label: "Proyectos", path: "/projects" },
  { label: "Sitios", path: "/sites" },
  { label: "Jornadas", path: "/sampling-events" },
  { label: "Árboles", path: "/trees" },
  { label: "Captura 4 vistas", path: "/images" },
  { label: "Anotaciones", path: "/annotations" },
  { label: "Análisis", path: "/analysis" },
  { label: "Calidad ambiental", path: "/environmental-quality" },
  { label: "Exportar", path: "/exports" },
];

export default navigation;
