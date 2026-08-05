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

## Fase 1 de Calidad Ambiental: contexto y contaminantes

Estas entidades solo agregan almacenamiento normalizado para datos que faltaban. Reutilizan (no duplican) `Site.latitude/longitude/radius_m/notes`, `SamplingEvent.sampled_at`, `Tree.species_name/species_confidence/latitude/longitude` y `TreeSample.sampling_height_m/trunk_orientation/notes`.

- `SiteEnvironmentalContext` (`public.site_environmental_contexts`): uno a uno con `Site` (`site_id` es clave primaria y foránea con `ON DELETE CASCADE`). Campos: `land_use_classification` (texto libre opcional), `is_reference_candidate` (**booleano opcional**: `true`/`false`/`NULL`, donde `NULL` representa estado de referencia desconocido — no se usa un literal de texto `unknown`), `measured_at`, `provenance`, `created_at`, `updated_at`.
- `TreeSampleScientificContext` (`public.tree_sample_scientific_contexts`): uno a uno con `TreeSample` (`tree_sample_id` es clave primaria y foránea con `ON DELETE CASCADE`). Campos: `sampled_width_cm`, `sampled_height_cm`, `dbh_cm` (diámetro a la altura del pecho del árbol hospedero — contexto estructural medido en el momento del muestreo; no duplica `Tree.species_name`/`species_confidence`), `bark_ph`, `bark_texture` (texto libre opcional), `canopy_cover_percent`, `air_temperature_c`, `relative_humidity_percent`, `measured_at`, `provenance`, `created_at`, `updated_at`.
- `PollutantMeasurement` (`public.pollutant_measurements`): cero o varias por `Site`; el `SamplingEvent` es opcional. Campos: `id`, `site_id`, `sampling_event_id` (nullable), `measured_at`, `pollutant_code`, `value`, `unit`, `averaging_period`, `instrument_method`, `data_source`, `qa_qc_status`, `notes`, `created_at`, `updated_at`. La clave foránea compuesta `pollutant_measurements_sampling_event_site_fk (sampling_event_id, site_id)` reutiliza `sampling_events_id_site_id_unique`. Con `sampling_event_id` nulo, PostgreSQL (`MATCH SIMPLE`) omite la verificación; si se proporciona, debe pertenecer al mismo `site_id`, impidiendo asociar un evento de otro sitio.

### Restricciones exactas

- `air_temperature_c`: `is null or (air_temperature_c >= -10 and air_temperature_c <= 50)`. Rango operativo de validación de plausibilidad (no científico); ver detalle en `docs/SCIENTIFIC_METHOD.md`.
- `relative_humidity_percent`: `is null or (relative_humidity_percent >= 0 and relative_humidity_percent <= 100)`.
- `canopy_cover_percent`: `is null or (canopy_cover_percent >= 0 and canopy_cover_percent <= 100)`.
- `sampled_width_cm`, `sampled_height_cm`, `dbh_cm`: `is null or valor > 0` para cada campo.
- `bark_ph`: `is null or (bark_ph >= 0 and bark_ph <= 14)`.
- `land_use_classification`, `bark_texture`, `provenance`: si se proporcionan, no vacíos y sin espacios al inicio o al final (máximo 160, 120 y 255 caracteres respectivamente).
- `value`: sin restricción de signo o rango; almacena la lectura numérica cruda del instrumento (deriva del sensor, calibración o artefactos pueden producir lecturas negativas). La confiabilidad se evalúa con `qa_qc_status`, no con una restricción de la base de datos.
- `unit` y `data_source`: obligatorios, no vacíos, sin espacios al inicio o al final; `unit` máximo 40 caracteres, `data_source` máximo 120 caracteres.
- `averaging_period` (máximo 40 caracteres) e `instrument_method` (máximo 160 caracteres): opcionales, sin espacios al inicio o al final si se proporcionan.
- **No existe ninguna restricción que combine `pollutant_code` con `unit`, y la base de datos no convierte unidades.**

### Valores permitidos (categóricos)

- `pollutant_code` (en `PollutantMeasurement`): `PM2.5`, `PM10`, `NO2`, `SO2`, `NH3`, `O3`, `CO`.
- `qa_qc_status` (en `PollutantMeasurement`): `not_assessed` (valor por defecto), `provisional`, `validated`, `rejected`.
- `land_use_classification` y `bark_texture` son texto libre; no tienen lista cerrada de valores permitidos.

### Limitación (solo descriptivo)

> Los datos de contexto ambiental y las mediciones de contaminantes almacenados en esta fase son exclusivamente descriptivos y no constituyen un índice, puntaje o estimación de calidad ambiental. LichenDR no calcula ni infiere calidad del aire, contaminación alta o baja, ni conversiones entre unidades de contaminantes. Cualquier interpretación ambiental requiere validación científica adicional por especialistas.

Esta fase no crea ninguna tabla de estimación, índice o puntaje ambiental.

### Referencias científicas

- EN 16413:2014. *Ambient air — Biomonitoring with lichens — Assessing epiphytic lichen diversity.*
- Counoy, H. et al. (2025). *Towards a New Interpretative Framework for Air Quality and Climate Biomonitoring With Lichens: A Meta-Analysis of Surveys Using the European Protocol.* Global Change Biology. DOI: [10.1111/gcb.70632](https://doi.org/10.1111/gcb.70632).
- Díaz, J. et al. (2021). *Epiphytic Cryptogams as Bioindicators of Air Quality in a Tropical Andean City.* Sustainability, 13(20), 11218. DOI: [10.3390/su132011218](https://doi.org/10.3390/su132011218).
- Sebald, J. et al. (2022). *NO2 air pollution drives species composition, but tree traits drive richness/diversity of epiphytic lichens in urban environments.* Environmental Pollution. DOI: [10.1016/j.envpol.2022.119678](https://doi.org/10.1016/j.envpol.2022.119678).
- Rautiainen, M., Kuusinen, N. & Majasalmi, T. (2024). *Remote sensing and spectroscopy of lichens.* Ecology and Evolution, 14(3), e11110. DOI: [10.1002/ece3.11110](https://doi.org/10.1002/ece3.11110).
- Cuenca et al. (2026). Atmospheric Pollution Research. DOI: [10.1016/j.apr.2026.103030](https://doi.org/10.1016/j.apr.2026.103030).
