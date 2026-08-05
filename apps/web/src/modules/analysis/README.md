# Analysis

El módulo muestra únicamente evaluaciones con `annotation_sets.status = 'completed'` y `completed_at` no nulo. Las agregaciones consultan `annotation_metrics`; no descargan máscaras al abrir el panel.

La cobertura por evaluación es la unión de píxeles de regiones de liquen aceptadas, intersectada con la máscara del tronco, dividida por los píxeles únicos del tronco. La cobertura agregada es ponderada:

`sum(lichen_union_area_pixels) / sum(trunk_area_pixels) × 100`

Las máscaras se cargan con URL firmada temporal solamente al abrir el detalle de lectura existente o al ejecutar **Calcular resumen**. Los borradores quedan excluidos incluso si conservan métricas de una finalización anterior.

Los resultados son descriptivos y provisionales. No constituyen por sí solos una clasificación de calidad ambiental.
