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
