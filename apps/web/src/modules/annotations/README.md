Propósito
: Administrar la base de datos para los conjuntos de anotación manual por puntos sobre imágenes.

Datos que administra
- `AnnotationSet`: define un conjunto de anotación asociado a una imagen y a una versión del método.
- `Morphotype`: describe los morfotipos visibles que pueden asociarse a puntos clasificados como `lichen`.
- `AnnotationPoint`: almacena cada punto de la cuadrícula, su clasificación y su nivel de confianza.

Responsabilidades actuales
- Crear la estructura de datos para la versión 1 del flujo de anotación manual.
- Guardar configuraciones de cuadrícula y ROI.
- Soportar la relación entre puntos, morfotipos y conjuntos de anotación.

Método de la versión 1
- La versión 1 utilizará una cuadrícula sistemática.
- El usuario clasificará todos los puntos.
- Los puntos evaluables serán `lichen`, `bark`, `moss` y `algae`.
- `shadow`, `glare` y `unknown` se excluirán del denominador.
- `lichen cover percentage = lichen points / evaluable points × 100`.
- Un morfotipo visible no equivale necesariamente a una especie.

Pendiente
- El canvas y la interfaz de anotación visual.
- Las herramientas de etiquetado y auditoría interactivas.
