import Link from "next/link";
import PageHeader from "./PageHeader";
import EmptyState from "./EmptyState";
export default function ConnectionNotice({
  previewOnly = false,
}: {
  previewOnly?: boolean;
}) {
  return (
    <>
      <PageHeader
        title={
          previewOnly
            ? "Vista previa de la interfaz"
            : "Conecta tu espacio de trabajo"
        }
        subtitle={
          previewOnly
            ? "La revisión visual está activa. Los datos y el guardado están desactivados en esta instalación."
            : "La conexión de datos de esta instalación todavía no está disponible."
        }
      />
      <section className="ld-placeholder">
        <EmptyState
          headingLevel={2}
          title="Tus datos requieren una conexión activa"
          icon="folder"
        >
          <p>
            Para cargar proyectos, recuperar jornadas y guardar observaciones,
            primero hay que completar la conexión de esta instalación. No se han
            cargado datos de tu cuenta.
          </p>
        </EmptyState>
        <p>
          Puedes consultar el recorrido de muestreo desde el inicio y volver a
          esta sección cuando la conexión esté lista.
        </p>
        <Link href="/" className="ld-button ld-button-outline">
          Volver al inicio
        </Link>
      </section>
    </>
  );
}
