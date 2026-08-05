# Base de datos Supabase

Esta documentación describe las migraciones de base de datos para los módulos Proyectos y Sitios.

## Qué crea la migración de proyectos

La migración crea la tabla `public.projects` con los campos:

- `id`: uuid, clave primaria, generado por `gen_random_uuid()`.
- `owner_id`: uuid obligatorio que referencia `auth.users(id)` y elimina en cascada cuando el usuario se borra.
- `name`: texto obligatorio, no vacío, sin espacios al inicio o al final, máximo 120 caracteres.
- `description`: texto opcional.
- `country_code`: texto obligatorio con valor por defecto `DO`.
- `status`: texto obligatorio con valor por defecto `active`.
- `created_at`: marca de tiempo con zona horaria, obligatorio, valor por defecto `now()`.
- `updated_at`: marca de tiempo con zona horaria, obligatorio, valor por defecto `now()`.

Además crea:

- una función y trigger para actualizar `updated_at` en cada modificación,
- un índice sobre `owner_id`,
- Row Level Security (RLS) activado en la tabla,
- políticas de acceso que restringen operaciones al dueño del registro.

## Qué crea la migración de sitios

La migración crea la tabla `public.sites` con los campos:

- `id`: uuid, clave primaria, generado por `gen_random_uuid()`.
- `project_id`: uuid obligatorio, referencia `public.projects(id)` con `on delete cascade`.
- `name`: texto obligatorio, no vacío, sin espacios al inicio o al final, máximo 120 caracteres.
- `description`: texto opcional.
- `country_code`: texto obligatorio con valor por defecto `DO`.
- `province`: texto opcional.
- `municipality`: texto opcional.
- `latitude`: double precision opcional.
- `longitude`: double precision opcional.
- `gps_accuracy_m`: double precision opcional.
- `location_source`: texto obligatorio con valor por defecto `unknown`.
- `radius_m`: integer obligatorio con valor por defecto `100`.
- `notes`: texto opcional.
- `created_at`: timestamptz obligatorio con valor por defecto `now()`.
- `updated_at`: timestamptz obligatorio con valor por defecto `now()`.

La migración de sitios también crea:

- una función y trigger para actualizar `updated_at` en cada modificación,
- índices sobre `project_id` y sobre `project_id` + `lower(name)` para asegurar unicidad por proyecto,
- Row Level Security (RLS) activado en la tabla,
- políticas de acceso que permiten SELECT, INSERT, UPDATE y DELETE solo cuando el proyecto relacionado pertenece al usuario autenticado.

## Qué crea la migración de jornadas de muestreo

La migración crea la tabla `public.sampling_events` con los campos:

- `id`: uuid, clave primaria, generado por `gen_random_uuid()`.
- `site_id`: uuid obligatorio, referencia `public.sites(id)` con `on delete cascade`.
- `sampled_at`: timestamptz obligatorio.
- `observer_names`: texto obligatorio, no vacío.
- `weather_notes`: texto opcional.
- `protocol_version`: texto obligatorio, no vacío, valor por defecto `1.0`.
- `status`: texto obligatorio con valor por defecto `draft`.
- `created_at`: timestamptz obligatorio con valor por defecto `now()`.
- `updated_at`: timestamptz obligatorio con valor por defecto `now()`.

La migración de jornadas de muestreo también crea:

- una función y trigger para actualizar `updated_at` en cada modificación,
- índices sobre `site_id` y `site_id` + `sampled_at`,
- Row Level Security (RLS) activado en la tabla,
- políticas de acceso que permiten SELECT, INSERT, UPDATE y DELETE solo cuando el sitio y el proyecto relacionados pertenecen al usuario autenticado.

## Qué crea la migración de árboles y muestras de árbol

La migración crea la tabla `public.trees` con los campos:

- `id`: uuid, clave primaria, generado por `gen_random_uuid()`.
- `site_id`: uuid obligatorio, referencia `public.sites(id)` con `on delete cascade`.
- `code`: texto obligatorio.
- `species_name`: texto opcional.
- `species_confidence`: texto obligatorio con valor por defecto `unknown`.
- `latitude`: double precision opcional.
- `longitude`: double precision opcional.
- `gps_accuracy_m`: double precision opcional.
- `location_source`: texto obligatorio con valor por defecto `unknown`.
- `notes`: texto opcional.
- `created_at`: timestamptz obligatorio con valor por defecto `now()`.
- `updated_at`: timestamptz obligatorio con valor por defecto `now()`.

La migración crea también la tabla `public.tree_samples` con los campos:

- `id`: uuid, clave primaria, generado por `gen_random_uuid()`.
- `site_id`: uuid obligatorio, referencia `public.sites(id)` con `on delete cascade`.
- `sampling_event_id`: uuid obligatorio.
- `tree_id`: uuid obligatorio.
- `substrate_type`: texto obligatorio con valor por defecto `tree_bark`.
- `trunk_orientation`: texto obligatorio con valor por defecto `unknown`.
- `sampling_height_m`: double precision opcional.
- `shade_level`: texto obligatorio con valor por defecto `unknown`.
- `confidence_level`: texto obligatorio con valor por defecto `unknown`.
- `notes`: texto opcional.
- `created_at`: timestamptz obligatorio con valor por defecto `now()`.
- `updated_at`: timestamptz obligatorio con valor por defecto `now()`.

La migración de árboles y muestras de árbol también crea:

- índices y restricciones de unicidad sobre códigos y relaciones compuestas,
- triggers `set_updated_at` para actualizar `updated_at` en ambas tablas,
- Row Level Security (RLS) activado en ambas tablas,
- políticas de acceso que permiten SELECT, INSERT, UPDATE y DELETE solo cuando el sitio y el proyecto relacionados pertenecen al usuario autenticado.

## Restricciones importantes en `public.sites`

- `name` no puede estar vacío.
- `name` no puede tener espacios al inicio o al final.
- `name` tiene un máximo de 120 caracteres.
- `latitude` debe estar entre -90 y 90 cuando se proporciona.
- `longitude` debe estar entre -180 y 180 cuando se proporciona.
- `gps_accuracy_m` debe ser mayor o igual a 0 cuando se proporciona.
- `latitude` y `longitude` deben estar ambas presentes o ambas ausentes.
- `country_code` debe ser `DO`.
- `location_source` solo acepta `unknown`, `manual`, `exif` o `gps`.
- `radius_m` solo acepta `50`, `100`, `250`, `500` o `1000`.

## Por qué utiliza `owner_id` y RLS

Se usa `owner_id` para asociar cada proyecto con el usuario autenticado que lo creó.
RLS protege los datos a nivel de fila, asegurando que un usuario autenticado solo pueda leer, insertar, actualizar o eliminar sus propios proyectos y sitios.

## Relación entre tablas

- Un `Project` puede tener múltiples `Site`.
- Cada `Site` pertenece a un solo `Project`.
- `radius_m` representa el radio futuro de agregación ambiental del sitio.

## Cómo aplicarla posteriormente desde Supabase SQL Editor

1. Abrir el proyecto en Supabase.
2. Ir a SQL Editor.
3. Crear una nueva consulta y pegar el contenido de `supabase/migrations/202607270001_create_projects.sql` y `supabase/migrations/202607270002_create_sites.sql`.
4. Ejecutar la consulta.

## Cómo verificar que las tablas y las políticas existen

En Supabase SQL Editor o en `psql` se puede verificar con consultas como:

- `select * from information_schema.tables where table_schema = 'public' and table_name in ('projects','sites');`
- `select * from pg_policy where tablename in ('projects','sites');`

También se puede revisar las tablas `public.projects` y `public.sites` en el panel de Table Editor.

## Qué crea la migración de imágenes y metadatos

La migración crea el bucket privado `lichen-images` en Supabase Storage y las tablas `public.images` y `public.image_metadata` para almacenar archivos de líquenes asociados a `public.tree_samples`.

### Tabla `public.images`

- `id`: uuid, clave primaria, generado por `gen_random_uuid()`.
- `tree_sample_id`: uuid obligatorio que referencia `public.tree_samples(id)` con `on delete cascade`.
- `storage_bucket`: texto obligatorio con valor por defecto `lichen-images`.
- `storage_path`: texto obligatorio, no vacío, sin espacios al inicio o al final, único.
- `original_filename`: texto obligatorio, no vacío, con máximo 255 caracteres.
- `mime_type`: texto obligatorio limitado a JPEG, PNG, WebP, HEIC, HEIF y TIFF.
- `file_size_bytes`: bigint obligatorio, mayor que 0 y máximo 20 MB.
- `width_px` y `height_px`: enteros opcionales mayores que 0 si se proporcionan.
- `image_order`: entero obligatorio mayor que 0.
- `caption`: texto opcional.
- `created_at` y `updated_at`: marcas de tiempo con zona horaria.

La ruta de almacenamiento futura sigue la estructura `owner_id/project_id/site_id/event_id/tree_sample_id/uuid.ext`.

### Tabla `public.image_metadata`

- `id`: uuid, clave primaria, generado por `gen_random_uuid()`.
- `image_id`: uuid obligatorio y único, referencia `public.images(id)` con `on delete cascade`.
- `extraction_status`: texto obligatorio con valores `pending`, `extracted`, `partial`, `no_exif` o `failed`.
- `captured_at`: timestamp opcional con la fecha original del archivo.
- `captured_at_local`: texto opcional que conserva la fecha original sin asumir una zona horaria inexistente.
- `timezone_offset`: texto opcional.
- `latitude` y `longitude`: double precision opcionales, con validación conjunta.
- `gps_accuracy_m`: double precision opcional mayor o igual a 0.
- `location_source`: texto obligatorio con valores `unknown`, `exif`, `manual` o `gps`.
- `camera_make`, `camera_model`, `lens_model`, `orientation`, `focal_length_mm`, `aperture_f_number`, `exposure_time_seconds`, `iso_speed`, `software`: campos opcionales de EXIF.
- `raw_exif`: jsonb opcional con valor por defecto `{}`.
- `extraction_error` y `extracted_at`: campos opcionales para trazabilidad.

### Bucket privado y RLS

- El bucket `lichen-images` se crea como privado (`public = false`) y con límite de 20 MB por archivo.
- Las tablas `images` e `image_metadata` habilitan RLS y exponen políticas para authenticated basadas en la propiedad del proyecto asociado al `TreeSample`.
- Los objetos en storage también tienen políticas de acceso para authenticated, validando que el primer directorio del path sea el UID del usuario.

### Consideraciones importantes

- EXIF puede estar ausente o haber sido eliminado; la tabla `image_metadata` puede existir en ese caso.
- `captured_at_local` conserva la fecha original sin asumir una zona horaria inexistente.
- `raw_exif` puede contener información sensible y no debe incluirse automáticamente en exportaciones CSV.

## Qué crea la migración de anotación manual por puntos

La migración crea tres tablas en `public` para soportar la anotación manual por puntos sobre imágenes:

- `public.annotation_sets`: almacena el conjunto de anotación de una imagen, la versión del método, la configuración de la cuadrícula, la ROI y el estado del trabajo.
- `public.morphotypes`: almacena los morfotipos asociados a un conjunto de anotación, con validación de etiqueta, forma de crecimiento y formato de color.
- `public.annotation_points`: almacena cada punto de la cuadrícula, su coordenada normalizada, clasificación y confianza.

### Reglas del método de la versión 1

- La versión 1 utilizará una cuadrícula sistemática.
- El usuario clasificará todos los puntos.
- Los puntos evaluables serán `lichen`, `bark`, `moss` y `algae`.
- `shadow`, `glare` y `unknown` se excluirán del denominador.
- `lichen cover percentage = lichen points / evaluable points × 100`.
- Un morfotipo visible no equivale necesariamente a una especie.

### Restricciones y seguridad

- Se agregan restricciones de dominio y unicidad para cada tabla.
- Se crean índices para `image_id`, `annotation_set_id`, `morphotype_id` y `classification`.
- Se habilita RLS en las tres tablas y se crean políticas `SELECT`, `INSERT`, `UPDATE` y `DELETE` para `authenticated` siguiendo la relación de propiedad desde el proyecto del usuario.

## Limitación actual

Todavía no es posible crear sitios desde la interfaz web porque la funcionalidad de Sitios aún no se ha implementado. La migración prepara solo la base de datos y las restricciones.

## Qué crea la migración de capas de anotación MobileSAM

La migración crea `public.annotation_regions` para persistir cada máscara aceptada como una capa independiente de un `annotation_set`.

- Registra la clasificación del vocabulario existente, morfotipo opcional, procedencia `mobile_sam`, nombre y versión del modelo, dimensiones, área, score y prompts positivos y negativos.
- Guarda la ubicación de la máscara derivada en `mask_bucket` y `mask_path`; la ruta es obligatoria, sin espacios externos y única.
- Un morfotipo solo se permite para `lichen` y la clave foránea compuesta garantiza que pertenezca al mismo `annotation_set`.
- Los prompts se validan como arrays JSON; el score es opcional y no negativo, sin límite máximo.
- Habilita RLS y crea las cuatro políticas de `authenticated` siguiendo `annotation_region → annotation_set → image → tree_sample → site → project → owner_id`.

La migración no modifica Storage. Las políticas existentes del bucket privado `lichen-images` permiten rutas de máscaras PNG cuyo primer directorio sea el UID autenticado, como `auth.uid()/project_id/site_id/event_id/tree_sample_id/masks/uuid.png`; no validan los directorios posteriores.

## Extensión para el editor visual

La migración `202608050001_extend_annotation_regions_for_visual_editor.sql` amplía de forma aditiva `annotation_regions`:

- `source` acepta `mobile_sam`, `manual` y `color_assisted` para conservar la procedencia real de cada máscara confirmada.
- `representative_color_hex` admite un color opcional en formato `#RRGGBB`.
- `color_tolerance_delta_e` admite una tolerancia CIELAB Delta E opcional entre 0 y 50.
- `region_role` identifica opcionalmente el `trunk`; una restricción exige clasificación `bark` y un índice parcial permite un solo tronco aceptado por `annotation_set`.

La selección por color convierte sRGB a CIELAB con iluminante D65 y usa Delta E 1976 (distancia euclidiana en L\*a\*b\*) como ayuda visual. No clasifica especies ni categorías automáticamente. La migración reutiliza el trigger `updated_at` existente y no cambia RLS ni las políticas de Storage.

## Métricas persistidas para Análisis

La migración aditiva `202608050002_create_annotation_metrics.sql` crea `public.annotation_metrics`. No modifica migraciones históricas ni ejecuta cálculos remotos.

- Mantiene una fila por `annotation_set_id`, con borrado en cascada.
- Guarda áreas de máscara, cobertura, conteos, método, versión, alertas de calidad y fechas de auditoría.
- Restringe áreas y conteos a valores no negativos, impone `morphotype_count <= lichen_region_count <= accepted_region_count` y evita que la unión de liquen supere el área del tronco.
- `coverage_percent` queda nulo si el tronco falta o tiene área cero. Cuando existe, exige tronco positivo, unión de liquen presente y concordancia con `lichen_union_area_pixels / trunk_area_pixels × 100` con tolerancia de 0.01 puntos porcentuales.
- Exige `quality_flags` como array u objeto JSON y textos no vacíos y sin espacios exteriores para método y versión.
- Reutiliza `public.set_updated_at()` y habilita RLS.
- Las políticas `SELECT`, `INSERT`, `UPDATE` y `DELETE` para `authenticated` siguen `annotation_metrics → annotation_sets → images → tree_samples → sites → projects → owner_id = auth.uid()`.
- No concede privilegios a `anon`.

Las consultas del panel parten de `annotation_sets` con `status = 'completed'` y `completed_at is not null`, y después consultan métricas persistidas. Las agregaciones no descargan máscaras. El recálculo de un resumen anterior obtiene URLs firmadas temporales para las máscaras de esa única evaluación.

`overlapping_lichen_pixels` se calcula dentro del tronco como `Σ popcount(Li AND T) − popcount(union(Li) AND T)`. La unión fuera del tronco se conserva separadamente en `lichen_outside_trunk_pixels`.

## Fase 1 de Calidad Ambiental: contexto y mediciones de contaminantes

La migración aditiva `202608060001_create_environmental_quality_context.sql` no modifica migraciones históricas ni ejecuta migraciones remotas. Antes de crear columnas nuevas, audita y reutiliza los campos ya existentes:

- `public.sites`: `latitude`, `longitude`, `radius_m`, `notes`.
- `public.sampling_events`: `sampled_at`.
- `public.trees`: `species_name`, `species_confidence`, `latitude`, `longitude`.
- `public.tree_samples`: `sampling_height_m`, `trunk_orientation`, `notes`.

Solo agrega almacenamiento normalizado para contexto que faltaba y mediciones de contaminantes opcionales. **No crea ninguna tabla de estimación, índice o puntaje de calidad ambiental.**

### Tabla `public.site_environmental_contexts` (uno a uno con `sites`)

- `site_id`: uuid, clave primaria, referencia `public.sites(id)` con `on delete cascade`.
- `land_use_classification`: texto libre opcional (no vacío, sin espacios al inicio o al final, máximo 160 caracteres si se proporciona). Sin lista cerrada de valores.
- `is_reference_candidate`: **booleano opcional**, no un texto con literal `unknown`. `true` = candidato de referencia/control confirmado, `false` = confirmado que no lo es, `NULL` = estado de referencia aún no evaluado ("desconocido" se representa con `NULL`, no con una cadena de texto).
- `measured_at`: timestamptz opcional (sin valor por defecto).
- `provenance`: texto libre opcional (no vacío, sin espacios al inicio o al final si se proporciona, máximo 255 caracteres).
- `created_at` y `updated_at`: timestamptz obligatorios con valor por defecto `now()` y trigger `set_updated_at`.

### Tabla `public.tree_sample_scientific_contexts` (uno a uno con `tree_samples`)

- `tree_sample_id`: uuid, clave primaria, referencia `public.tree_samples(id)` con `on delete cascade`.
- `sampled_width_cm` y `sampled_height_cm`: double precision opcionales. Restricción exacta: `is null or valor > 0` para cada uno (dimensiones del área de muestra evaluada).
- `dbh_cm`: double precision opcional (diámetro a la altura del pecho, DAP, del árbol hospedero). Restricción exacta: `dbh_cm is null or dbh_cm > 0`. Es contexto estructural del árbol hospedero medido en el momento del muestreo; no duplica la identidad de especie, que ya se registra en `trees.species_name`/`trees.species_confidence`.
- `bark_ph`: double precision opcional. Restricción exacta: `bark_ph is null or (bark_ph >= 0 and bark_ph <= 14)`.
- `bark_texture`: texto libre opcional (no vacío, sin espacios al inicio o al final, máximo 120 caracteres si se proporciona). Sin lista cerrada de valores.
- `canopy_cover_percent`: double precision opcional. Restricción exacta: `is null or (canopy_cover_percent >= 0 and canopy_cover_percent <= 100)`.
- `air_temperature_c`: double precision opcional. Restricción exacta: `air_temperature_c is null or (air_temperature_c >= -10 and air_temperature_c <= 50)`. Es un rango operativo de validación de plausibilidad (no un rango científico establecido); ver detalle en `docs/SCIENTIFIC_METHOD.md`.
- `relative_humidity_percent`: double precision opcional. Restricción exacta: `is null or (relative_humidity_percent >= 0 and relative_humidity_percent <= 100)`.
- `measured_at`: timestamptz opcional (sin valor por defecto).
- `provenance`: texto libre opcional (mismas reglas que en `site_environmental_contexts`).
- `created_at` y `updated_at`: timestamptz obligatorios con valor por defecto `now()` y trigger `set_updated_at`.

### Tabla `public.pollutant_measurements` (cero o varias por sitio; el evento de muestreo es opcional)

- `id`: uuid, clave primaria, generado por `gen_random_uuid()`.
- `site_id`: uuid obligatorio, referencia `public.sites(id)` con `on delete cascade`.
- `sampling_event_id`: uuid **opcional (nullable), pero consistente con el sitio cuando se proporciona**. La clave foránea compuesta `pollutant_measurements_sampling_event_site_fk (sampling_event_id, site_id)` reutiliza la restricción única existente `sampling_events_id_site_id_unique` (creada en `202607270004_create_trees_and_tree_samples.sql`). Con `sampling_event_id` nulo, la semántica `MATCH SIMPLE` de PostgreSQL omite la verificación de la clave foránea; cuando se proporciona un valor, debe pertenecer al mismo `site_id` o la inserción falla.
- `measured_at`: timestamptz obligatorio, sin valor por defecto (debe proporcionarse explícitamente).
- `pollutant_code`: texto obligatorio con lista cerrada de valores permitidos: `PM2.5`, `PM10`, `NO2`, `SO2`, `NH3`, `O3` o `CO`.
- `value`: double precision obligatorio. **Sin restricción de signo o rango**: almacena la lectura numérica cruda del instrumento tal como se reporta (la deriva del sensor, los desplazamientos de calibración o los artefactos del instrumento pueden producir lecturas crudas negativas). La confiabilidad se evalúa mediante `qa_qc_status`, no rechazando el valor al insertarlo.
- `unit`: texto obligatorio, no vacío, sin espacios al inicio o al final, máximo 40 caracteres. **No existe ninguna restricción que combine `pollutant_code` con `unit`, y la migración no convierte unidades.**
- `averaging_period`: texto opcional (p. ej. `1 h`, `24 h`), sin espacios al inicio o al final si se proporciona, máximo 40 caracteres.
- `instrument_method`: texto opcional, sin espacios al inicio o al final si se proporciona, máximo 160 caracteres.
- `data_source`: texto obligatorio, no vacío, sin espacios al inicio o al final, máximo 120 caracteres (sin valor por defecto).
- `qa_qc_status`: texto obligatorio, valor por defecto `not_assessed`; acepta `not_assessed`, `provisional`, `validated` o `rejected`.
- `notes`: texto opcional.
- `created_at` y `updated_at`: timestamptz obligatorios con valor por defecto `now()` y trigger `set_updated_at`.

### Índices creados

- `idx_site_environmental_contexts_is_reference_candidate` sobre `site_environmental_contexts`.
- `idx_tree_sample_scientific_contexts_measured_at` sobre `tree_sample_scientific_contexts`.
- `idx_pollutant_measurements_site_id`, `idx_pollutant_measurements_sampling_event_id`, `idx_pollutant_measurements_pollutant_code`, `idx_pollutant_measurements_measured_at_desc` e `idx_pollutant_measurements_qa_qc_status` sobre `pollutant_measurements`.

Las claves primarias de `site_environmental_contexts` y `tree_sample_scientific_contexts` ya proveen el índice de la relación uno a uno con `sites` y `tree_samples` respectivamente.

### Triggers `updated_at`

Las tres tablas reutilizan la función existente `public.set_updated_at()` (no es `SECURITY DEFINER`) mediante `drop trigger if exists set_updated_at ...; create trigger set_updated_at before update ... execute function public.set_updated_at();`, igual que el resto del esquema.

### RLS y propiedad

Las tres tablas habilitan RLS. Cada política se recrea con `drop policy if exists ...;` inmediatamente antes de `create policy ...` para permitir reejecución segura:

- `site_environmental_contexts`: `site_environmental_contexts → sites → projects.owner_id = auth.uid()`.
- `tree_sample_scientific_contexts`: `tree_sample_scientific_contexts → tree_samples → sites → projects.owner_id = auth.uid()`.
- `pollutant_measurements`: `pollutant_measurements → sites → projects.owner_id = auth.uid()` (usa `site_id` directo, igual que `tree_samples`).

Las cuatro políticas (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) están limitadas a `to authenticated`. Ninguna función usa `SECURITY DEFINER`.

### Privilegios mínimos

Cada tabla ejecuta `revoke all on table public.<tabla> from anon;` seguido de `grant select, insert, update, delete on public.<tabla> to authenticated;`. `anon` no tiene ningún privilegio sobre estas tablas.

### Por qué el rango de temperatura documentado

`air_temperature_c` (en `tree_sample_scientific_contexts`) acepta valores entre -10 °C y 50 °C. Este es un **rango operativo de validación de plausibilidad** para lecturas de temperatura ambiente de campo, cuyo único propósito es rechazar errores evidentes de captura de datos (p. ej. un dígito mal escrito o una confusión de escala). **No se afirma que Counoy et al. (2025) ni ninguna otra referencia citada establezca científicamente este rango exacto**; ningún estudio citado especifica estos límites numéricos. Los valores fuera de rango se **rechazan**, nunca se recortan (clamp) ni se modifican silenciosamente. La temperatura se registra únicamente como una variable climática descriptiva que ayuda a interpretar la respuesta de los líquenes en el momento y lugar de la muestra; nunca se convierte ni se usa para calcular un índice o estimación ambiental.

### Aviso obligatorio

> Los datos de contexto ambiental y las mediciones de contaminantes almacenados en esta fase son exclusivamente descriptivos y no constituyen un índice, puntaje o estimación de calidad ambiental. LichenDR no calcula ni infiere calidad del aire, contaminación alta o baja, ni conversiones entre unidades de contaminantes. Cualquier interpretación ambiental requiere validación científica adicional por especialistas.

### Referencias científicas

- EN 16413:2014. *Ambient air — Biomonitoring with lichens — Assessing epiphytic lichen diversity.*
- Counoy, H. et al. (2025). *Towards a New Interpretative Framework for Air Quality and Climate Biomonitoring With Lichens: A Meta-Analysis of Surveys Using the European Protocol.* Global Change Biology. DOI: [10.1111/gcb.70632](https://doi.org/10.1111/gcb.70632).
- Díaz, J. et al. (2021). *Epiphytic Cryptogams as Bioindicators of Air Quality in a Tropical Andean City.* Sustainability, 13(20), 11218. DOI: [10.3390/su132011218](https://doi.org/10.3390/su132011218).
- Sebald, J. et al. (2022). *NO2 air pollution drives species composition, but tree traits drive richness/diversity of epiphytic lichens in urban environments.* Environmental Pollution. DOI: [10.1016/j.envpol.2022.119678](https://doi.org/10.1016/j.envpol.2022.119678).
- Rautiainen, M., Kuusinen, N. & Majasalmi, T. (2024). *Remote sensing and spectroscopy of lichens.* Ecology and Evolution, 14(3), e11110. DOI: [10.1002/ece3.11110](https://doi.org/10.1002/ece3.11110).
- Cuenca et al. (2026). Atmospheric Pollution Research. DOI: [10.1016/j.apr.2026.103030](https://doi.org/10.1016/j.apr.2026.103030).
