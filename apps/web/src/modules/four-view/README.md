Propósito
: Captura guiada de las cuatro vistas (N/E/S/O) de un árbol dentro de una jornada y su calibración con la plantilla LICHENDR-FRAME-0.2.

Ficheros principales
- `Workflow.tsx`: pantalla de captura. Muestra el contexto (Proyecto / Sitio / Jornada / Árbol) resuelto desde la jornada, los cuatro espacios con su estado y el resumen de progreso.
- `capture-flow.ts`: lógica pura y testeable del flujo (progreso, disparo único del análisis, textos de estado, clasificación de fallos, contexto legible).
- `client.ts`: acceso a Supabase y a las funciones de visión.
- `navigation.ts`: destinos del flujo, incluido «Siguiente árbol de esta jornada».

Reglas del flujo
- El análisis de la serie empieza automáticamente y **solo** cuando las cuatro vistas del mismo árbol y serie están listas. Una carga en curso, un fallo o una vista pendiente de confirmación manual mantienen la serie bloqueada.
- `SeriesAnalysisGate` evita ejecuciones duplicadas por doble clic, efectos de React, finalización simultánea de cargas, reintentos o navegación. La identidad del intento incluye la serie y la fotografía concreta de cada vista, por lo que una respuesta antigua nunca sobrescribe una imagen reemplazada.
- Los fallos se explican en español sencillo; el texto original se conserva como detalle diagnóstico depurado de enlaces y tokens. Los fallos permanentes (validación, permisos, formato) no se presentan como recuperables ni se reintentan automáticamente.
- El contexto nunca se sustituye en silencio: si el enlace no resuelve, se explica y se ofrece volver a «Preparar jornada».
