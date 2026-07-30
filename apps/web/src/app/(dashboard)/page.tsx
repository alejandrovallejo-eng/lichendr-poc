import PageHeader from "@/components/PageHeader";
import MetricCard from "@/components/MetricCard";
import ModulePlaceholder from "@/components/ModulePlaceholder";

export default function DashboardPage() {
  return (
    <div className="w-full">
      <PageHeader title="LichenDR" subtitle="Biomonitoreo de líquenes para la República Dominicana" />

      <p className="text-sm mb-4" style={{ color: "var(--ld-text-secondary)" }}>
        Organiza sitios, jornadas de muestreo, árboles e imágenes para generar una señal ambiental basada en líquenes.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <MetricCard label="Sitios" value={0} />
        <MetricCard label="Jornadas" value={0} />
        <MetricCard label="Árboles" value={0} />
        <MetricCard label="Imágenes" value={0} />
      </div>

      <div className="mb-6">
        <a
          href="/projects"
          className="inline-block px-4 py-2 rounded border"
          style={{ background: "var(--ld-sand)", color: "var(--ld-text)", borderColor: "var(--ld-border)" }}
        >
          Crear primer proyecto
        </a>
      </div>

      <section className="mb-6">
        <h3 className="font-semibold" style={{ color: "var(--ld-text)" }}>Flujo</h3>
        <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>Proyecto → Sitio → Jornada → Árbol → Imagen</p>
      </section>

      <section className="mb-6">
        <h3 className="font-semibold" style={{ color: "var(--ld-text)" }}>Aviso científico</h3>
        <div style={{ background: "#EAF3EA", borderRadius: 8, padding: 12, border: "1px solid var(--ld-border)" }}>
          <p className="text-sm" style={{ color: "var(--ld-text)" }}>No existen datos suficientes para una estimación ambiental.</p>
        </div>
      </section>

      <ModulePlaceholder title="Vista rápida de módulos" />
    </div>
  );
}
