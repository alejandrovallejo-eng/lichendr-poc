Diccionario de datos (inicial)

- `Project`: id(uuid), name, description, createdAt
- `Site`: id, projectId, name, description, country_code, province, municipality, latitude, longitude, gps_accuracy_m, location_source, radius_m, notes, createdAt, updatedAt
- `SamplingEvent`: id, siteId, date, observer
- `Tree`: id, siteId, tag, species, createdAt
- `TreeSample`: id, treeId, samplingEventId, notes
- `ImageRecord`: id, treeSampleId, image metadata, uri
- `AnnotationSet`: id, imageId, morphotypes, createdAt

Relaciones:

- Un `Project` puede tener múltiples `Site`.
- Cada `Site` pertenece a un solo `Project`.
- `radius_m` representa el radio de agregación ambiental futuro para el sitio.
