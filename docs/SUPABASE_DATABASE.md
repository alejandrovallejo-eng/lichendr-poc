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

## Limitación actual

Todavía no es posible crear sitios desde la interfaz web porque la funcionalidad de Sitios aún no se ha implementado. La migración prepara solo la base de datos y las restricciones.
