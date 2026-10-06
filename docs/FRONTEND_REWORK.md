# Análisis y rework del frontend de LichenDR

Revisión del 5 de octubre de 2026 de la aplicación Next.js en `apps/web`, rama `v1-modular`. El rework mejora el inicio, la navegación, los estilos compartidos y la presentación de los flujos existentes. La validación con datos reales queda pendiente: el usuario solicitó continuar sin conectar la base de datos.

## Skills investigadas y aplicadas

| Skill y fuente original | Encaje con LichenDR | Aplicación |
| --- | --- | --- |
| [frontend-design, Anthropic](https://github.com/anthropics/skills/tree/main/skills/frontend-design) | Dirección visual propia para una herramienta de biomonitoreo. | Inicio basado en el trabajo de campo; diagrama de cuatro orientaciones; jerarquía de acciones, tipografía y paleta coherentes. |
| [web-design-guidelines, Vercel](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines) | Auditoría de navegación, accesibilidad, formularios y estados. | Foco visible, salto al contenido, estado activo, navegación móvil, mensajes accesibles, controles táctiles y estados vacíos. |
| [react-best-practices, Vercel](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices) | La aplicación usa React y Next.js y dispone de herramientas de edición grandes. | Componentes estáticos sin `use client`; carga diferida de herramientas alternativas; enlaces Next.js en formularios de administración. |

Las tres skills están instaladas en `~/.codex/skills/` y se leyeron durante este trabajo. El catálogo oficial de [skills de Vercel](https://vercel.com/docs/agent-resources/skills) documenta las dos últimas. Las reglas de accesibilidad se contrastaron con [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md).

Se consideraron skills de Figma, pero no había un archivo de diseño que implementar. Las de despliegue y React Native no resuelven el rework de esta aplicación web. La selección se basa en el código inspeccionado, no en el número de instalaciones de cada skill.

## Hallazgos del análisis inicial

- `src/app/globals.css:48`: la regla que imponía `display: block` a `nav` anulaba la navegación móvil oculta en escritorio y afectaba layouts flex. Corregido.
- `src/app/(dashboard)/page.tsx:15`: cuatro métricas fijas en cero podían confundirse con datos reales. Se eliminaron del inicio.
- `src/components/MobileNavigation.tsx:6`: faltaban estado activo y organización móvil; once enlaces se mostraban en una tira. Sustituida por un menú desplegable nativo.
- `src/components/AppShell.tsx:12`: faltaba un salto al contenido. Añadido.
- `src/app/globals.css:30`: Arial reemplazaba las fuentes locales ya configuradas. Ahora se utiliza Geist local.
- `src/app/(dashboard)/projects/page.tsx:121`: los mensajes de error y éxito no se anunciaban mediante roles accesibles. Corregidos en proyectos, sitios y jornadas.
- `src/components/PageHeader.tsx:1`: componentes estáticos estaban marcados como clientes. Se simplificaron encabezados, métricas y estructura de la aplicación.
- `src/modules/analysis/AnalysisEntry.tsx:4` y `src/modules/annotations/AnnotationsEntry.tsx:4`: se importaban herramientas alternativas antes de saber cuál se necesitaba. Se difieren esas ramas.
- `src/lib/supabase/client.ts:8`: la ausencia de configuración interrumpía las pantallas con un error técnico. Las rutas ahora comprueban la configuración antes de importar el flujo de datos.

Las ubicaciones anteriores corresponden al código inspeccionado antes del rework; los archivos de administración se movieron a `route-content.tsx` durante la implementación.

## Dirección visual

La identidad sigue siendo la de una herramienta de campo: verde bosque `#173D35`, fondo gris verdoso `#F3F6F5`, texto `#17231F`, superficie blanca `#FFFFFF`, borde `#D6E1DB` y acento liquénico `#E4D58D`. La fuente principal es Geist, distribuida localmente con el proyecto. No se añadieron dependencias de UI, librerías de iconos ni fuentes remotas.

El diagrama N/E/S/O del inicio explica las cuatro orientaciones de un tronco. Es una ilustración conceptual, no una medición ni un resultado. El resto de la interfaz prioriza lectura, jerarquía de acciones y espacio de trabajo.

## Cambios por flujo

| Área | Resultado del rework |
| --- | --- |
| Inicio | Acciones para preparar o continuar jornadas; recorrido de captura y revisión; alcance científico explícito. |
| Navegación | Grupos por tarea, iconos locales, sección activa, reconocimiento de `/jornada/[eventId]`, menú móvil que se cierra al cambiar de ruta. |
| Proyectos | Formulario y lista en columnas en escritorio; campos con nombres, límite y ejemplo; mensajes accesibles; reintento de lectura y estado vacío contextual. |
| Sitios y jornadas | Enlaces de navegación Next.js, mensajes accesibles y estilos compartidos de formularios. |
| Preparación y árboles | Encabezados y superficies comunes; guía de etapas; textos de preparación orientados a la acción. |
| Captura | Encabezado unificado y selectores dependientes desactivados cuando aún no tienen opciones. Se conserva el orden N/E/S/O y el guardado existente. |
| Anotación | Carga diferida del editor correspondiente, foco y superficies comunes. Los colores de clases y las operaciones de máscaras se conservan. |
| Análisis y calidad ambiental | Encabezados consistentes, eliminación de `main` anidados en las vistas clásicas y estado vacío de resultados con una siguiente acción. Las métricas y avisos científicos existentes se conservan. |
| Cuenta | Encabezado compartido; lógica de acceso Google sin cambios. |
| Exportación | Estado de desarrollo explícito y accesos a jornadas/resultados. La exportación general ya estaba pendiente y continúa pendiente; no se simula una descarga. |

Las rutas conservan sus parámetros y contexto. `page.tsx` comprueba la conexión y `route-content.tsx` mantiene cada flujo original. Las comprobaciones no crean registros ni sustituyen datos.

## Revisión local sin base de datos

**Actualización posterior:** el usuario autorizó la conexión real. El primer paso
de integración está descrito en [DATABASE_SETUP.md](DATABASE_SETUP.md): la clave
pública local se completó, `LICHENDR_PREVIEW_ONLY` pasó a `0` y se comprobaron
lecturas/escrituras y Storage reales. El texto siguiente conserva el contexto de
la revisión visual anterior; ya no describe el modo local actual.

`LICHENDR_PREVIEW_ONLY=1` está activo únicamente en el archivo local ignorado `.env.local`, conforme a la preferencia del usuario. El inicio y la navegación se pueden revisar en `http://localhost:3000`. Las pantallas de datos muestran un estado de revisión visual y no montan sus flujos de lectura/guardado. No se modificaron las credenciales existentes.

Para recuperar los flujos conectados, retirar esa variable o establecerla en `0`, con las variables públicas de Supabase configuradas. No configurar este modo en Producción. Esta vista previa no es un modo de trabajo offline ni una base de datos simulada.

## Validación

- TypeScript y ESLint del código de navegación, componentes, rutas y entradas modificadas: correctos.
- `npm test`: correcto; incluye métricas, contexto de captura, persistencia, proxy de imágenes, disponibilidad y rutas de segmentación.
- `npm run test:component`: 34 pruebas correctas.
- Panel de resultados guiados: 11 pruebas correctas con Supabase sustituido por el stub del repositorio. El ejecutor Node necesita resolver los alias `@/`; se usó un resolver temporal fuera del repositorio.
- Compilación de producción con Webpack y verificación de Sharp: correctas. Advertencia de dependencia dinámica en `libheif-js`, fuera del cambio visual.
- Turbopack no completó la compilación en este entorno: su proceso CSS no pudo abrir un puerto interno (`Operation not permitted`).
- Navegador real: inicio en escritorio y a 390 px; sin desbordamiento horizontal a 390 px; menú móvil, cambio de ruta, cierre automático y selección activa comprobados.

No se validaron escrituras en Supabase, autenticación real, subida de fotografías ni llamadas a MobileSAM/BioCLIP. Las pruebas de componentes usan servicios simulados. La revisión visual de las pantallas que requieren datos reales queda pendiente para cuando se habilite la conexión. Los cambios siguen locales, sin publicación ni commit.

## Integración posterior

El rework conserva el diseño y conecta ahora datos alojados y motores privados.
Las capacidades de MobileSAM y BioCLIP se consultan por separado, el guardado
distingue borrador sincronizado de revisión confirmada y el modo manual permanece
disponible. Exportar incluye CSV, JSON y copia de registros/fotografías. Los
recorridos de resultados, cierre y exportación forman parte de `npm test`.
Ver [AI_SETUP.md](AI_SETUP.md) y [BACKUPS.md](BACKUPS.md) para comprobaciones y
limitaciones operativas; el estilo visual no certifica una conclusión científica.
