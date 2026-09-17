# Recortes revisables y próxima evaluación de BioCLIP

## Cambio de interfaz

`BioClipEvidence` usa exclusivamente la geometría normalizada que guardó el
servidor. Une recortes, sugerencias habituales y comparación experimental por
`regionId`, no por posición. El panel está cerrado inicialmente; al abrirlo se
puede ver un recorte, ubicarlo en la fotografía y pasar al siguiente ejemplo.

Es una vista de lectura: no invoca modelos, descarga fotos adicionales, escribe
revisiones, acepta etiquetas ni altera coberturas. Las fotografías siguen siendo
los proxies privados ya abiertos por la app. La miniatura representa la región
enviada, no pretende reproducir byte a byte el tensor redimensionado del encoder.
Con `standard_center_crop` se avisa del recorte central del modelo.

Si faltan coordenadas en una revisión antigua, son inválidas/ambiguas, o la
fotografía no está disponible, no se inventa la miniatura. Se conserva el texto
del resultado. Una identidad de foto/árbol/orientación diferente no se muestra.

No se modifican `checkLichenSamples`, tamaños de recorte, umbrales, pesos,
preprocesamiento, caché, servicio Cloud Run, RLS ni secretos.

## Protocolo de evaluación a preparar antes de cambiar el clasificador

### Dos preguntas distintas

1. **Clasificación:** ¿qué material contiene el recorte?, ¿el punto de interés
   coincide con ese material? La etiqueta de la foto entera no responde ambas.
2. **Segmentación/cobertura:** ¿qué píxeles del tronco corresponden al liquen?
   Se necesitan máscaras de referencia, no etiquetas de fotografía.

### Selección y separación

- Recoger fotografías nuevas y autorizadas, con atribución/licencia cuando
  procedan de iNaturalist. Las fotos del estudio y diagnóstico del 17/09/2026
  quedan solo para desarrollo; no se reciclan como prueba independiente.
- Incluir líquenes, musgo, corteza expuesta, algas, otros hongos y regiones
  mixtas/no determinables. Incluir variedad de iluminación, distancia y tonos.
- Separar por árbol/observación/autor ANTES de entrenar. Todas las escalas,
  puntos y vistas de una misma fuente permanecen en el mismo grupo y partición.
- Fijar la lista y el protocolo antes de ejecutar los modelos. No escoger
  fotografías o recortes en función de sus predicciones.

### Registro mínimo por ejemplo

Identificador de fotografía y hash del proxy; origen/licencia/autor; grupo de
árbol/observación; partición; punto normalizado; contorno del tronco; caja real
del servidor y tamaño de rejilla; etiquetas revisadas **por separado** del
punto y del contenido del recorte; nombre del revisor; versión del protocolo.
Las etiquetas permanecen pendientes hasta revisión: no heredarlas de la foto.

### Comparación sin cambiar el producto

- Congelar el método habitual como referencia. Evaluar contexto local y uno
  mayor con una regla fija; conservar TODOS los resultados y los desacuerdos.
- No escoger automáticamente la escala que diga «liquen». Registrar abstención,
  falsos positivos/negativos, sensibilidad por clase y proporción de respuestas.
- Comparar sobre los mismos grupos independientes y presentar intervalos de
  incertidumbre agrupando por fotografía/árbol. No contar cuatro vistas o
  múltiples recortes como observaciones independientes.
- Antes de promocionar una variante, fijar márgenes de no inferioridad para
  sensibilidad de liquen y falsos positivos, y dimensionar la prueba. No
  redefinir los criterios después de ver resultados. Esta preparación no
  afirma que el candidato actual haya superado esos criterios.

### Validación de cobertura independiente

Delimitar manualmente tronco y liquen en una muestra nueva, guardar las máscaras
de referencia separadas y hacer revisión independiente de regiones difíciles.
Medir IoU/Dice dentro del mismo tronco y error absoluto de cobertura en puntos
porcentuales; publicar casos de sombra, sustrato parecido y regiones mixtas.
No derivar automáticamente la verdad de referencia del gotero ni de BioCLIP.

La cobertura por color y el catálogo humano siguen siendo revisables. Ni esta
evaluación ni iNaturalist por sí solos validan una estimación de calidad de aire.

## Pruebas de interfaz

`bioclip-evidence.test.tsx`: orden alterado de respuestas, separación de
identidades, geometría ausente/duplicada/inválida, navegación de ejemplos,
recorte explícito para no mostrar píxeles vecinos en bandas vacías, lectura
sin solicitudes de IA y conservación de entradas. Ejecutar además las pruebas
existentes de captura, guardado y resultados. Las pruebas de UI no miden
precisión científica y no justifican promocionar el modelo experimental.
