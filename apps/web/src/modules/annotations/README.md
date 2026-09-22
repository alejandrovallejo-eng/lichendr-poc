# Annotations

Annotation Studio administra conjuntos de anotación, morfotipos, puntos y regiones de máscara. Las capas aceptadas conservan su procedencia (`mobile_sam`, `manual`, `color_assisted` o `automatic_four_view`), clasificación, morfotipo, color representativo y tolerancia Delta E cuando corresponda.

## Finalización

**Finalizar y guardar evaluación** conserva primero todas las regiones válidas, calcula la unión de máscaras, guarda o actualiza `annotation_metrics` y solo entonces cambia el conjunto a `completed`. Si el cálculo, la lectura de máscaras o el guardado falla, el conjunto permanece `draft`, las regiones se conservan y la operación se puede reintentar.

La cobertura es:

`píxeles de la unión de liquen dentro del tronco / píxeles únicos del tronco × 100`

Las regiones solapadas se cuentan una sola vez. La falta de tronco, el área cero o las dimensiones incompatibles producen “Datos insuficientes” y una alerta de calidad, no una cobertura fabricada a partir de `area_pixels`.

Al reabrir, el conjunto vuelve a `draft` y queda fuera de Análisis. La métrica anterior puede conservarse, pero no se presenta hasta finalizar y recalcular.

Los resultados son descriptivos y provisionales. No constituyen por sí solos una clasificación de calidad ambiental.
