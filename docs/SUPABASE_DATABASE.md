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
