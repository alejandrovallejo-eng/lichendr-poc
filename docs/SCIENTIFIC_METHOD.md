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
