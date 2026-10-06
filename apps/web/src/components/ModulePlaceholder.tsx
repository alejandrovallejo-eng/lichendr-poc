import Link from "next/link";
import PageHeader from "./PageHeader";
import EmptyState from "./EmptyState";
export default function ModulePlaceholder({ title }: { title: string }) {
  return (
    <>
      <PageHeader
        title={title}
        subtitle="Consulta los resultados y conserva el contexto de tu muestreo."
      />
      <section className="ld-placeholder">
        <EmptyState
          headingLevel={2}
          title="Este módulo todavía está en desarrollo"
          icon="download"
        >
          <p>
            La exportación general aún no está disponible. Puedes revisar las
            jornadas y sus resultados en las secciones de análisis y calidad
            ambiental.
          </p>
        </EmptyState>
        <div className="flex flex-wrap gap-3 mt-5">
          <Link href="/analysis" className="ld-button ld-button-outline">
            Revisar resultados
          </Link>
          <Link href="/sampling-events" className="ld-text-link">
            Ver jornadas
          </Link>
        </div>
      </section>
    </>
  );
}
