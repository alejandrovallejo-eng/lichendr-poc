# Flujo científico de cuatro vistas

El flujo predeterminado de **Captura 4 vistas** reutiliza un árbol permanente y obtiene o crea una sola `tree_sample` para ese árbol dentro de la jornada. Cada `capture_series` conserva cuatro vistas activas N/E/S/O; reemplazar una vista desactiva la anterior y mantiene `replaces_view_id`.

## Procesamiento

Las vistas se procesan secuencialmente porque MobileSAM comparte un predictor CPU protegido por un lock. Para cada fotografía, el servicio:

1. valida MIME, firma, tamaño y dimensiones (incluido HEIC/HEIF ISO-BMFF);
2. exige los ArUco 0, 1, 2 y 3 de `DICT_5X5_50`;
3. calcula la homografía desde las posiciones físicas de `LICHENDR-FRAME-0.2`;
4. produce exclusivamente la ventana de 400 × 2000 px (40 px/cm);
5. aplica controles de marcadores, homografía, resolución, desenfoque, exposición y reflejos;
6. obtiene candidatos MobileSAM y elimina máscaras pequeñas, contenidas o duplicadas;
7. une solapamientos y agrupa provisionalmente con color CIELAB y textura;
8. guarda originales, rectificados y unión de máscaras bajo una ruta privada cuyo primer segmento es `auth.uid()`.

Una condición crítica produce `repeat_photo` y ninguna cobertura. Las cuatro vistas deben ser válidas para que la serie pase a `provisional_ai`. La confirmación cambia los conjuntos de anotación a `completed`; por eso Análisis excluye propuestas provisionales de sus indicadores principales.

Antes de cargar imágenes se confirman explícitamente el árbol y la jornada. Si una solicitud falla, las vistas ya guardadas permanecen en la serie y el reintento procesa solamente las vistas pendientes o fallidas con la misma clave idempotente. Una fotografía nueva crea un reemplazo trazable; una serie confirmada no se modifica.

## Fórmulas

Cada píxel canónico representa `500 cm² / (400 × 2000)`.

```text
valid_area_view = píxeles válidos × 500 / 800000
lichen_union_area_view = píxeles de la unión de máscaras × 500 / 800000
lichen_coverage_view = lichen_union_area_view / valid_area_view × 100

total_valid_area_cm2 = suma(valid_area_view N, E, S, O)
total_lichen_area_cm2 = suma(lichen_union_area_view N, E, S, O)
tree_lichen_coverage_percent =
  total_lichen_area_cm2 / total_valid_area_cm2 × 100
```

Los solapamientos se cuentan una sola vez mediante OR binario. Una serie completa tiene 2,000 cm² y 20 celdas posibles. La frecuencia de un morfotipo es la cantidad de celdas, de 0 a 20, en las que aparece.
La cobertura agregada del árbol queda nula mientras no existan cuatro vistas válidas; los totales parciales se conservan únicamente para orientar el reintento.

## Limitación científica

MobileSAM segmenta formas, pero no clasifica taxones. Los códigos `LQ-001`, `LQ-002`, etc. son **morfotipos visuales provisionales**, derivados de propuestas de máscara, color normalizado y textura. No son especies, riqueza taxonómica ni LDV. Sin fotografías de campo etiquetadas no se ha validado la capacidad de distinguir liquen, corteza y musgo de forma confiable.

## Codespaces

1. Aplicar la migración nueva **solo al Supabase local**: `supabase/migrations/202608060002_create_four_view_capture_series.sql`.
2. Configurar `apps/web/.env.local` con las variables Supabase existentes y `VISION_SERVICE_URL=http://127.0.0.1:8000`.
3. Ejecutar `bash scripts/setup-vision-service.sh`.
4. Ejecutar `bash scripts/dev-with-vision.sh`.
5. Comprobar que Next.js escucha en `0.0.0.0:3000` y visión solo en `127.0.0.1:8000`.
6. Crear proyecto, sitio, jornada y árbol antes de abrir **Captura 4 vistas**.

No ejecutar esta migración automáticamente contra Supabase remoto.

## Plantilla

Regenerar con `python scripts/generate-lichen-frame.py`. Imprimir el PDF de plotter o las tres páginas A4 al **100%**, sin ajuste. En A4, superponer 2.5 mm y alinear la ventana. Verificar con regla:

- barra: 100 mm;
- ventana: 100 × 500 mm;
- cada marcador: 20 × 20 mm.

Si cualquier medida difiere más de 1 mm, corregir la configuración de impresión y reimprimir.
