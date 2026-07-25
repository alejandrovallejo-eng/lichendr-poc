import PageHeader from "@/components/PageHeader";
import MetricCard from "@/components/MetricCard";
import ModulePlaceholder from "@/components/ModulePlaceholder";

export default function DashboardPage() {
  return (
    <div>
      <PageHeader title="LichenDR" subtitle="Biomonitoreo de líquenes para la República Dominicana" />

      <p className="text-sm text-zinc-600 mb-4">
        Organiza sitios, jornadas de muestreo, árboles e imágenes para generar una señal ambiental basada en líquenes.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <MetricCard label="Sitios" value={0} />
        <MetricCard label="Jornadas" value={0} />
        <MetricCard label="Árboles" value={0} />
        <MetricCard label="Imágenes" value={0} />
      </div>

      <div className="mb-6">
        <button className="px-4 py-2 rounded bg-yellow-200 border">Crear primer proyecto (pendiente)</button>
      </div>

      <section className="mb-6">
        <h3 className="font-semibold">Flujo</h3>
        <p className="text-sm text-zinc-600">Proyecto → Sitio → Jornada → Árbol → Imagen</p>
      </section>

      <section className="mb-6">
        <h3 className="font-semibold">Aviso científico</h3>
        <p className="text-sm text-zinc-600">No existen datos suficientes para una estimación ambiental.</p>
      </section>

      <ModulePlaceholder title="Vista rápida de módulos" />
    </div>
  );
}
