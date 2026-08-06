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
