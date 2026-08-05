Método científico y consideraciones

- Los morfotipos visuales NO equivalen automáticamente a especies.
- Cobertura y diversidad se analizan como métricas separadas.
- Las estimaciones ambientales requieren un mínimo de muestreo antes de ser informativas.
- Los algoritmos y modelos deben versionarse y sus resultados conservar trazabilidad.
- La imagen original NUNCA debe ser modificada; las derivadas deben almacenarse por separado.
- Las máscaras aceptadas de MobileSAM se conservan como capas de anotación separadas, con modelo, versión, prompts y score para mantener trazabilidad.
- La versión 1 utilizará una cuadrícula sistemática.
- El usuario clasificará todos los puntos.
- Los puntos evaluables serán `lichen`, `bark`, `moss` y `algae`.
- `shadow`, `glare` y `unknown` se excluirán del denominador.
- `lichen cover percentage = lichen points / evaluable points × 100`.
- Un morfotipo visible no equivale necesariamente a una especie.

## Cobertura descriptiva mediante máscaras

Para cada evaluación completada, la versión `1.0.0` del método `mask_union_intersection`:

1. crea la máscara binaria del tronco confirmado;
2. crea la unión binaria de todas las regiones aceptadas clasificadas como `lichen`;
3. intersecta esa unión con el tronco;
4. cuenta por separado los píxeles de liquen fuera del tronco y los píxeles solapados;
5. calcula `coverage_percent = lichen_union_inside_trunk_pixels / trunk_pixels × 100`.

La unión evita contar dos veces regiones solapadas. Las máscaras deben compartir dimensiones. Si el tronco falta, tiene área cero o existen dimensiones incompatibles, la cobertura queda nula y se presenta “Datos insuficientes”.

Se marca `high_lichen_overlap` cuando los píxeles solapados representan al menos el 20 % de la suma de áreas de las máscaras de liquen. Este umbral es una alerta de revisión de datos, no una interpretación ambiental.

La cobertura ponderada para varias imágenes es:

`sum(lichen_union_inside_trunk_pixels) / sum(trunk_pixels) × 100`

La mediana, mínimo y máximo por imagen se muestran como estadísticas complementarias; no sustituyen la cobertura ponderada.

## Inclusión, trazabilidad y limitaciones

Análisis usa exclusivamente `annotation_sets.status = 'completed'` con `completed_at is not null`. Los borradores se excluyen aunque conserven una métrica anterior. Las máscaras se descargan solo para calcular o revisar una evaluación; las agregaciones usan métricas persistidas con método, versión, fecha y alertas.

“Cobertura observada de líquenes” es un resultado descriptivo y una estimación provisional. No equivale a buena o mala calidad ambiental, contaminación alta o baja, ni aire limpio o contaminado. Se requiere calibración científica adicional antes de derivar cualquiera de esas categorías.

Los resultados son descriptivos y provisionales. No constituyen por sí solos una clasificación de calidad ambiental.
