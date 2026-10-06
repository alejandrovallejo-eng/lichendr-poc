import type { Metadata } from "next";
import Demo from "@/modules/demo/Demo";

export const metadata: Metadata = { title: "LichenDR · Ejemplo interactivo", description: "Explora las cuatro vistas, la revisión de líquenes y el montaje 360°; crea tu propia copia para usar LichenDR." };
export default function DemoPage() { return <Demo />; }
