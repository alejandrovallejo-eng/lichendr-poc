# Base de datos Supabase

Esta documentación describe la migración de base de datos para el módulo Proyectos.

## Qué crea la migración

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

## Por qué utiliza `owner_id` y RLS

Se usa `owner_id` para asociar cada proyecto con el usuario autenticado que lo creó.
RLS protege los datos a nivel de fila, asegurando que un usuario autenticado sólo pueda leer, insertar, actualizar o eliminar sus propios proyectos.

## Cómo aplicarla posteriormente desde Supabase SQL Editor

1. Abrir el proyecto en Supabase.
2. Ir a SQL Editor.
3. Crear una nueva consulta y pegar el contenido de `supabase/migrations/202607270001_create_projects.sql`.
4. Ejecutar la consulta.

## Cómo verificar que la tabla y las políticas existen

En Supabase SQL Editor o en `psql` se puede verificar con consultas como:

- `select * from information_schema.tables where table_schema = 'public' and table_name = 'projects';`
- `select * from pg_policy where tablename = 'projects';`

También se puede revisar la tabla `public.projects` en el panel de Table Editor.

## Limitación actual

Todavía no es posible crear un proyecto desde la interfaz web porque no se ha implementado la autenticación o la gestión de sesión en la aplicación. La migración sólo prepara la base de datos y las restricciones.
