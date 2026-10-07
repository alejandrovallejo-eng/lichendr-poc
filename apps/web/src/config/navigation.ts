export type NavItem = {
  label: string;
  path: string;
  group: string;
  icon:
    | "home"
    | "field"
    | "folder"
    | "pin"
    | "calendar"
    | "tree"
    | "camera"
    | "edit"
    | "chart"
    | "leaf"
    | "download";
};
export const navigation: NavItem[] = [
  { label: "Inicio", path: "/", group: "Tu espacio", icon: "home" },
  { label: "Espacios compartidos", path: "/compartidos", group: "Tu espacio", icon: "folder" },
  {
    label: "Preparar jornada",
    path: "/preparar-jornada",
    group: "Trabajo de campo",
    icon: "field",
  },
  {
    label: "Proyectos",
    path: "/projects",
    group: "Trabajo de campo",
    icon: "folder",
  },
  { label: "Sitios", path: "/sites", group: "Trabajo de campo", icon: "pin" },
  {
    label: "Jornadas",
    path: "/sampling-events",
    group: "Trabajo de campo",
    icon: "calendar",
  },
  { label: "Árboles", path: "/trees", group: "Trabajo de campo", icon: "tree" },
  {
    label: "Captura 4 vistas",
    path: "/images",
    group: "Registro y revisión",
    icon: "camera",
  },
  {
    label: "Anotaciones",
    path: "/annotations",
    group: "Registro y revisión",
    icon: "edit",
  },
  { label: "Análisis", path: "/analysis", group: "Resultados", icon: "chart" },
  {
    label: "Calidad ambiental",
    path: "/environmental-quality",
    group: "Resultados",
    icon: "leaf",
  },
  {
    label: "Exportar",
    path: "/exports",
    group: "Resultados",
    icon: "download",
  },
];
export function isNavActive(pathname: string, path: string) {
  if (path === "/sampling-events" && pathname.startsWith("/jornada/"))
    return true;
  return pathname === path || (path !== "/" && pathname.startsWith(`${path}/`));
}
export default navigation;
