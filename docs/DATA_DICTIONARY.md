Diccionario de datos (inicial)

- `Project`: id(uuid), name, description, createdAt
- `Site`: id, projectId, name, latitude, longitude, altitude, createdAt
- `SamplingEvent`: id, siteId, date, observer
- `Tree`: id, siteId, tag, species, createdAt
- `TreeSample`: id, treeId, samplingEventId, notes
- `ImageRecord`: id, treeSampleId, image metadata, uri
- `AnnotationSet`: id, imageId, morphotypes, createdAt
