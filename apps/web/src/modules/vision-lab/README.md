# Laboratorio IA

Esta vista experimental permite probar la segmentación asistida con MobileSAM vit_t en el servicio local de visión.

## Objetivo

Evaluar y aceptar máscaras propuestas a partir de puntos positivos y negativos. Las imágenes locales conservan sus capas solo en memoria; las imágenes guardadas crean o reutilizan un conjunto `ai_assisted_segmentation` y persisten máscaras PNG privadas.

## Notas de privacidad

- Las imágenes guardadas y las máscaras usan URLs firmadas temporales de hasta diez minutos.
- Las máscaras se guardan en `lichen-images` bajo `{auth_uid}/annotations/{annotation_set_id}/{region_id}.png`.
- La vista no expone rutas de Storage ni guarda data URLs en PostgreSQL.
