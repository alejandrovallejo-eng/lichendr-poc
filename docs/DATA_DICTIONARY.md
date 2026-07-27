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
