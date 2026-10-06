import Link from "next/link";
import FieldDiagram from "@/components/FieldDiagram";
import NavIcon from "@/components/NavIcon";
const steps = [
 { title: "Prepara la jornada", description: "Define el proyecto, el sitio y los árboles que vas a muestrear.", href: "/preparar-jornada", action: "Preparar jornada", icon: "field" as const },
 { title: "Registra las cuatro vistas", description: "Captura norte, este, sur y oeste del mismo tronco y revisa su ubicación.", href: "/images", action: "Abrir captura", icon: "camera" as const },
 { title: "Revisa la evidencia", description: "Confirma las anotaciones antes de interpretar la cobertura y la diversidad.", href: "/annotations", action: "Revisar imágenes", icon: "edit" as const },
];
export default function DashboardPage() {
 return <div className="ld-home">
  <section className="ld-home-intro"><div><h1>Tu próxima jornada<br />empieza aquí.</h1><p>Un espacio para observar, registrar y estudiar los líquenes de la República Dominicana.</p></div><div className="ld-banner-actions"><Link href="/demo" className="ld-text-link">Explorar un ejemplo completo</Link><Link href="/sampling-events" className="ld-text-link">Continuar una jornada</Link></div></section>
  <section className="ld-field-banner" aria-labelledby="field-heading"><div className="ld-field-copy"><h2 id="field-heading">Del árbol al<br />registro de campo.</h2><p>Prepara tu sitio de muestreo, registra cada árbol y reúne las cuatro vistas del tronco en una misma jornada.</p><div className="ld-banner-actions"><Link href="/preparar-jornada" className="ld-button ld-button-sand"><NavIcon name="field" />Preparar jornada</Link><Link href="/projects" className="ld-banner-link">Ver mis proyectos</Link></div></div><FieldDiagram /></section>
  <section className="ld-home-steps" aria-labelledby="steps-heading"><div className="ld-section-heading"><h2 id="steps-heading">Un recorrido, de campo a resultados</h2><p>Cada etapa conserva el contexto de tu muestreo.</p></div><ol>{steps.map((step,index) => <li key={step.href}><div className="ld-home-step-top"><span className="ld-step-number">{index+1}</span><NavIcon name={step.icon} /></div><h3>{step.title}</h3><p>{step.description}</p><Link href={step.href} className="ld-text-link">{step.action}</Link></li>)}</ol></section>
  <div className="ld-home-bottom"><section className="ld-evidence-note"><NavIcon name="leaf" /><div><h2>Observaciones con contexto</h2><p>La cobertura y los morfotipos describen tu muestra. Una interpretación ambiental requiere datos suficientes, revisión y validación científica.</p><Link href="/environmental-quality" className="ld-text-link">Consultar el alcance de los resultados</Link></div></section><section className="ld-home-library"><h2>Tu trabajo organizado</h2><p>Consulta los sitios, jornadas y árboles de tus proyectos.</p><Link href="/projects" className="ld-button ld-button-outline"><NavIcon name="folder" />Abrir proyectos</Link></section></div>
 </div>;
}
