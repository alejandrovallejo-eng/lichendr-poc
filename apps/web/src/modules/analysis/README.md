# Analysis

El módulo muestra únicamente evaluaciones con `annotation_sets.status = 'completed'` y `completed_at` no nulo. Las agregaciones consultan `annotation_metrics`; no descargan máscaras al abrir el panel.

La cobertura por evaluación es la unión de píxeles de regiones de liquen aceptadas, intersectada con la máscara del tronco, dividida por los píxeles únicos del tronco. La cobertura agregada es ponderada:

`sum(lichen_union_area_pixels) / sum(trunk_area_pixels) × 100`

El solapamiento también se mide dentro del tronco:

`Σ popcount(Li AND T) − popcount(union(Li) AND T)`

El área de unión fuera del tronco se registra aparte como `lichen_outside_trunk_pixels`; no forma parte de `overlapping_lichen_pixels`.

Las máscaras se cargan con URL firmada temporal solamente al abrir el detalle de lectura existente o al ejecutar **Calcular resumen**. Este recálculo consulta regiones aceptadas por el identificador de una única evaluación completada, no modifica regiones ni estado y guarda métricas nulas con una alerta de calidad cuando una máscara no está disponible. Los borradores quedan excluidos incluso si conservan métricas de una finalización anterior.

Los resultados son descriptivos y provisionales. No constituyen por sí solos una clasificación de calidad ambiental.
