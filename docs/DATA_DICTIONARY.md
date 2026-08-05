Diccionario de datos (inicial)

- `Project`: id(uuid), name, description, createdAt
- `Site`: id, projectId, name, description, country_code, province, municipality, latitude, longitude, gps_accuracy_m, location_source, radius_m, notes, createdAt, updatedAt
- `SamplingEvent`: id, siteId, sampled_at, observer_names, weather_notes, protocol_version, status, createdAt, updatedAt
- `Tree`: id, siteId, code, species_name, species_confidence, latitude, longitude, gps_accuracy_m, location_source, notes, createdAt, updatedAt
- `TreeSample`: id, site_id, sampling_event_id, tree_id, substrate_type, trunk_orientation, sampling_height_m, shade_level, confidence_level, notes, createdAt, updatedAt
- `ImageRecord`: id, treeSampleId, image metadata, uri
- `AnnotationSet`: id, imageId, morphotypes, createdAt

Relaciones:

- Un `Project` puede tener múltiples `Site`.
- Cada `Site` pertenece a un solo `Project`.
- `radius_m` representa el radio de agregación ambiental futuro para el sitio.
- Un `TreeSample` puede tener múltiples `Image` registradas, cada una con su propio `ImageMetadata`.

## Imágenes y metadatos

- `Image`: representa un archivo de imagen asociado a un `TreeSample`; se almacena en el bucket privado `lichen-images` y usa `storage_path` con la estructura `owner_id/project_id/site_id/event_id/tree_sample_id/uuid.ext`.
- `ImageMetadata`: captura metadata de extracción, EXIF y contexto geográfico de una imagen; puede existir incluso cuando EXIF está ausente o fue eliminado.
- `captured_at_local`: conserva la fecha original del archivo sin asumir una zona horaria inexistente.
- `raw_exif`: puede contener información sensible y no debe incluirse automáticamente en exportaciones CSV.

### Estados de extracción

- `pending`: aún no se ha intentado extraer metadata.
- `extracted`: se extrajo metadata correctamente.
- `partial`: se extrajo parte de la metadata, pero faltan campos.
- `no_exif`: la imagen no tiene EXIF o no se pudo leer.
- `failed`: la extracción falló.

### Fuentes de ubicación

- `unknown`: sin coordenadas.
- `exif`: coordenadas derivadas de EXIF.
- `manual`: coordenadas agregadas manualmente.
- `gps`: coordenadas obtenidas por GPS.

## Bucket privado de Supabase Storage

- `lichen-images` es un bucket privado con límite de 20 MB por archivo.
- Los tipos MIME permitidos son JPEG, PNG, WebP, HEIC, HEIF y TIFF.
- El acceso está restringido a usuarios autenticados y la ruta debe comenzar con el UID del usuario.

## Anotación manual por puntos

- `AnnotationSet`: representa un conjunto de anotación asociado a una imagen y a una versión del método; incluye `method`, `status`, `version`, `grid_rows`, `grid_columns`, `roi_*`, `notes`, `completed_at` y marcas de auditoría.
- `Morphotype`: representa un morfotipo visible asociado a un `AnnotationSet`; guarda `label`, `growth_form`, `color_hex` y notas de contexto.
- `AnnotationPoint`: representa un punto de la cuadrícula sistemática con `point_index`, coordenadas normalizadas, `classification`, `confidence_level` y `notes`.

### Regla de cobertura de la versión 1

- La versión 1 utilizará una cuadrícula sistemática.
- El usuario clasificará todos los puntos.
- Los puntos evaluables serán `lichen`, `bark`, `moss` y `algae`.
- `shadow`, `glare` y `unknown` se excluirán del denominador.
- `lichen cover percentage = lichen points / evaluable points × 100`.
- Un morfotipo visible no equivale necesariamente a una especie.

## Capas de anotación MobileSAM

- `AnnotationRegion`: representa una máscara aceptada como capa independiente de un `AnnotationSet`.
- Conserva la clasificación existente (`lichen`, `bark`, `moss`, `algae`, `shadow`, `glare` o `unknown`), el morfotipo opcional, la procedencia (`mobile_sam`, `manual` o `color_assisted`), el nombre y versión del método/modelo, dimensiones, área, score, prompts positivos/negativos, estado y notas.
- Las selecciones visuales pueden guardar `representative_color_hex` y `color_tolerance_delta_e` en el rango de 0 a 50; ambos campos son opcionales y no implican una identificación automática.
- `region_role = trunk` identifica de forma explícita la única máscara de tronco evaluable aceptada por conjunto; esa región siempre se clasifica como `bark`.
- `mask_bucket` y `mask_path` identifican el archivo derivado; la ruta es única y no modifica la imagen original.
- Un morfotipo solo puede asociarse a una capa `lichen` y debe pertenecer al mismo `AnnotationSet`.
- Las capas admiten los estados `draft`, `accepted` y `rejected`.

### Compatibilidad con Storage privado

Las políticas actuales de `lichen-images` permiten leer, crear, actualizar y eliminar una máscara PNG con una ruta que comience por el UID autenticado. Las capas de MobileSAM usan `{auth_uid}/annotations/{annotation_set_id}/{region_id}.png`. No validan los directorios posteriores ni la relación con la imagen; esta fase no modifica esas políticas ni crea objetos en Storage.

El editor visual conserva capas confirmadas por el usuario separadas de las anotaciones por puntos. La cobertura provisional usa la unión de las máscaras de liquen, recortada por la máscara confirmada de tronco, para evitar doble conteo entre máscaras solapadas.

## Métricas descriptivas de anotación

- `AnnotationMetric`: resumen reproducible 1:1 de un `AnnotationSet`; la clave primaria y foránea `annotation_set_id` usa `ON DELETE CASCADE`.
- `trunk_area_pixels`: píxeles únicos distintos de cero de la máscara de tronco confirmada.
- `lichen_union_area_pixels`: píxeles únicos de la unión de máscaras `lichen` aceptadas que están dentro del tronco. Este es el numerador de cobertura.
- `lichen_outside_trunk_pixels`: píxeles de la unión de liquen fuera del tronco.
- `overlapping_lichen_pixels`: solapamiento calculado exclusivamente dentro del tronco: `Σ popcount(Li AND T) − popcount(union(Li) AND T)`. Los píxeles solapados no se vuelven a contar en cobertura.
- El solapamiento o área fuera del tronco no se mezcla con esa métrica; `lichen_outside_trunk_pixels` registra por separado la unión de liquen fuera de `T`.
- `coverage_percent`: `lichen_union_area_pixels / trunk_area_pixels × 100`; queda nulo si el tronco falta, tiene área cero o las dimensiones son incompatibles.
- `accepted_region_count`, `lichen_region_count` y `morphotype_count`: conteos descriptivos de la evaluación.
- `calculation_method`, `calculation_version` y `calculated_at`: trazabilidad del algoritmo ejecutado.
- `quality_flags`: array u objeto JSON con alertas de integridad o suficiencia.

Las agregaciones de Análisis incluyen únicamente conjuntos con `status = 'completed'` y `completed_at` no nulo. Una métrica conservada tras reabrir una evaluación no se presenta mientras el conjunto sea `draft`.
