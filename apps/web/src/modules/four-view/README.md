Propósito
: Captura guiada de las cuatro vistas (N/E/S/O) de un árbol dentro de una jornada y su calibración con la plantilla LICHENDR-FRAME-0.2.

Ficheros principales
- `Workflow.tsx`: pantalla de captura. Muestra el contexto (Proyecto / Sitio / Jornada / Árbol) resuelto desde la jornada, los cuatro espacios con su estado y el resumen de progreso.
- `capture-flow.ts`: lógica pura y testeable del flujo (estados, progreso separado, verificación de originales guardados, disparo único del análisis, clasificación de fallos, contexto legible, restauración).
- `capture-run.ts`: orquestación de una ejecución de la serie con servicios inyectables (guardar → preparar → verificar → analizar → finalizar).
- `client.ts`: acceso a Supabase y a las funciones de visión.
- `navigation.ts`: destinos del flujo, incluido «Siguiente árbol de esta jornada».

Reglas del flujo
- Guardar y analizar son fases distintas. Primero se guardan y preparan las cuatro fotografías; solo cuando `verifyStoredSeries` confirma que existen cuatro originales de **esta** serie empieza la inferencia, que sigue siendo serial.
- Una carga fallida deja la serie fuera de la fase de análisis y conserva las fotografías que sí se guardaron: el reintento sube únicamente lo que falta.
- El arranque automático se reserva a una captura nueva (hay al menos una vista recién seleccionada). Al reabrir una serie ya guardada, el usuario decide cuándo analizarla.
- `SeriesAnalysisGate` es una única instancia de módulo, compartida por todos los montajes de la pantalla: doble clic, efectos de React, cargas que terminan a la vez, reintentos y remontajes pasan por la misma compuerta. Tras una **recarga completa** la compuerta es nueva; en ese caso la protección real es el estado persistido, porque las vistas ya guardadas no se vuelven a subir y las ya analizadas no se vuelven a analizar.
- Las respuestas tardías se descartan comparando la identidad de la fotografía (`requestKey`) y el contexto del árbol (`contextMatchesTree`) después de cada `await`.
- El progreso usa contadores separados —seleccionadas, guardadas, analizadas, requieren revisión, no completadas— para que una fotografía guardada nunca desaparezca del resumen ni aparezcan mensajes contradictorios.
- Al reabrir el mismo enlace se restaura la serie exacta del árbol: originales guardados (miniatura recuperada desde almacenamiento privado, sin exponer URLs firmadas), resultados y propuestas de recorte persistidas. Si una propuesta no se guardó, se dice explícitamente y se vuelve a calcular sin pedir una nueva subida. Un solo reintento por vista.
- Los fallos se explican en español sencillo; el texto original se conserva como detalle diagnóstico depurado de enlaces y tokens. Los fallos permanentes (validación, permisos, formato) no se presentan como recuperables ni se reintentan automáticamente.
- El contexto nunca se sustituye en silencio: si el enlace no resuelve, se explica y se ofrece volver a «Preparar jornada».
