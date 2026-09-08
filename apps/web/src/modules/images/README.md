Propósito
: Gestionar imágenes asociadas a muestras de árbol y jornadas.

Datos que administra
- `ImageRecord` y `ImageMetadata` (fichero, dimensiones, fecha)

Responsabilidades
- Almacenar referencias a imágenes
- Mostrar miniaturas y metadatos
- Validar el contexto autenticado completo antes de subir
- Guardar cada archivo de forma independiente en el bucket privado `lichen-images`
- Eliminar el objeto recién subido si falla el registro en base de datos

Pendiente
- Conversión HEIC/HEIF fiable como mejora separada. Hasta entonces, el selector rechaza esos formatos y solicita JPEG o PNG.
The default `/images` route is the guided LICHENDR-FRAME-0.2 N/E/S/O workflow. The original metadata-first batch uploader remains available at `/images/advanced`.

HEIC/HEIF originals are accepted only when MIME, extension, and ISO-BMFF `ftyp` brand agree. Conversion and scientific processing happen in the private Python vision service; the original is retained for traceability.
