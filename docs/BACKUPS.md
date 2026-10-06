# Copias y recuperación

## Copia de una cuenta

En **Exportar → Descargar copia con fotografías**, LichenDR descarga un TAR con:

- `records.json`: las 20 tablas visibles al propietario mediante RLS; incluye
  originales, contexto, anotaciones y revisiones, con sus identificadores.
- `manifest.json`: rutas privadas, tamaños y SHA-256 de cada archivo.
- `files/`: los bytes de los archivos del propietario en `lichen-images`.

El cliente comprueba que la sesión, los registros y el listado de archivos no
cambien durante la descarga. Un error cancela la copia completa. Guardar las
revisiones primero. La lectura usa páginas de 200 registros y Storage usa páginas
de 100 objetos. La descarga del navegador admite hasta 256 MiB de archivos;
volúmenes mayores requieren un respaldo administrativo, no repetir la descarga.
No es una transacción global de PostgreSQL: se detectan cambios comparando los
registros y metadatos antes/después; evitar capturas concurrentes durante la copia.

La copia contiene datos privados y puede contener GPS. Conservarla fuera del
repositorio, con permisos restringidos y una segunda copia en un medio seguro.
JSON y CSV solos **no** incluyen los bytes de las fotografías.

Comprobar un archivo descargado, desde `apps/web`:

```bash
npm run backup -- --verify /ruta/a/copia.tar
```

El verificador rechaza archivos alterados, rutas que salen del propietario,
entradas duplicadas y objetos no declarados. No escribe en Supabase ni imprime
los datos científicos o credenciales.

## Recuperación de una cuenta

La recuperación local usa una sesión vigente del **propietario original** en
`SUPABASE_BACKUP_ACCESS_TOKEN`, cargada desde un archivo local protegido e ignorado
por Git. Nunca pegar un token en un comando o en un mensaje. Usar la misma base,
el mismo usuario Auth y las migraciones compatibles.

```bash
npm run backup -- --restore /ruta/a/copia.tar
```

La orden comprueba integridad, propietario, relaciones entre tablas y ausencia de
los registros y archivos de destino antes de escribir. No hace `upsert`, no
sobrescribe proyectos y conserva RLS. Solo permite recuperar una copia cuyos
proyectos originales ya no existen; una cuenta vacía no equivale a recuperar
usuarios de Auth. Un usuario nuevo tiene otro UUID y no puede apropiarse de la copia.

Las revisiones guiadas conservan sus versiones y datos. Los catálogos y cuadrantes
ecológicos se recrean mediante sus RPC autorizadas: conservan UUID, nombres y
contenido científico; sus revisiones de concurrencia y `updated_at` se generan
de nuevo. No convertir un antiguo número de revisión en una expectativa de
escritura después de recuperar.

Las políticas actuales impiden insertar revisiones guiadas de fotografías
sustituidas/inactivas. El recuperador detecta ese caso **antes de escribir** y
requiere recuperación administrativa para ese historial. La copia conserva ese
historial, aunque este recuperador con permisos de usuario no pueda reinsertarlo.
Los cuadrantes también necesitan su vista actual y el tronco confirmado. No se
relajan políticas para eludir estos controles.

Las operaciones de recuperación entre tablas y Storage no son una transacción
única. Ante un fallo, se intenta retirar solo los proyectos, vistas y archivos
cuya creación fue confirmada en ese intento. Si se pierde una respuesta o falla
esa limpieza, revisar el destino antes de repetir; no asumir atomicidad. Los
manifiestos de proxies pueden necesitar reconstrucción al abrir la fotografía,
pues el respaldo no exporta metadatos internos de objetos de Storage.

## Recuperación completa del servicio

El TAR de una cuenta no cubre otras cuentas, usuarios/identidades de Auth,
configuración de proveedores, roles ni secretos. Las migraciones del repositorio
recrean el esquema en una base nueva; no recuperar datos con `db reset` sobre
una base usada.

Una copia administrativa requiere acceso PostgreSQL para esquema/datos/usuarios,
respaldo de todos los bytes privados de Storage y configuración protegida de
Supabase/Google/Vercel/Render. No poner una clave `service_role` en Next.js público.
La recuperación completa debe probarse en un proyecto aislado, comparando tablas,
usuarios, políticas, SHA-256 y capacidad de entrada y análisis antes de cambiar
el dominio. Las copias de PostgreSQL por sí solas no guardan los archivos de Storage.

La automatización global no está activada sin las credenciales administrativas;
no confundir una copia descargada manualmente con un respaldo programado del
servicio. Definir también retención y destino seguro para esas copias.

Referencia: [copias de Supabase](https://supabase.com/docs/guides/platform/backups).

## Acceso administrativo pendiente

La revisión del 5 de octubre de 2026 no encontró credenciales administrativas
en los archivos de configuración de las dos copias locales del proyecto ni una
sesión de Supabase CLI. Esto no demuestra que no existan en un gestor de
contraseñas o en otra ubicación.

Se preparó `/Users/alejandro/.lichendr/backup-admin.env`, fuera del repositorio,
con permisos `600`. Contiene los parámetros públicos del **Session pooler** del
proyecto `taqdmdghdqnczioxhajb`; `PGPASSWORD` y `SUPABASE_ADMIN_KEY` están vacíos.
El archivo no se carga en Next.js y no activa ninguna automatización.

Para completar el acceso, el propietario puede guardar localmente:

1. La contraseña actual de PostgreSQL, correspondiente a **Connect → Direct →
   Session pooler**. La conexión de Google a la aplicación no proporciona esta
   contraseña. Si no puede recuperarla, debe completar personalmente el cambio
   en **Database → Settings**, comprobando qué otras conexiones la usan.
2. Una clave administrativa **existente** del mismo proyecto, desde **Settings →
   API Keys**, para descargar los archivos privados de todas las cuentas.
   La clave pública usada por la interfaz no tiene esos permisos.

No pegar estos valores en mensajes, no incluirlos en comandos del historial ni
añadirlos a variables `NEXT_PUBLIC_*`. La creación de nuevas credenciales o la
concesión de acceso adicional requiere autorización específica.

Después de disponer del acceso hay que implementar y comprobar el respaldo de
roles, esquema, datos Auth/aplicación, historial de migraciones, archivos y
configuración; definir destino y retención; y probar la restauración en un
proyecto aislado. Solo entonces se puede habilitar una programación y describirla
como respaldo administrativo operativo.

Referencias: [conexión y recuperación con Supabase CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore),
[claves públicas y administrativas](https://supabase.com/docs/guides/getting-started/api-keys).
