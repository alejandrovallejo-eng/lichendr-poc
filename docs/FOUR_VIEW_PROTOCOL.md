# Flujo científico de cuatro vistas

El flujo predeterminado de **Captura 4 vistas** reutiliza un árbol permanente y obtiene o crea una sola `tree_sample` para ese árbol dentro de la jornada. Cada `capture_series` conserva cuatro vistas activas N/E/S/O; reemplazar una vista desactiva la anterior y mantiene `replaces_view_id`.

## Procesamiento

La captura y la anotación son etapas separadas. Para cada fotografía, el servicio:

1. valida MIME, firma, tamaño y dimensiones (incluido HEIC/HEIF ISO-BMFF);
2. aplica la orientación EXIF antes de detectar y limita la imagen decodificada a 60 megapíxeles;
3. busca los ArUco 0, 1, 2 y 3 de `DICT_5X5_50` con una pirámide acotada y variantes de gris, CLAHE, gamma, umbral adaptativo y recuperación de contraste;
4. refina candidatos rechazados contra el `Board` físico de `LICHENDR-FRAME-0.2`, ajusta esquinas a nivel subpíxel y conserva las observaciones repetidas más estables;
5. calcula la homografía desde todas las esquinas decodificadas y, cuando faltan marcadores, busca la abertura mediante bordes, contornos y soporte de líneas;
6. permite seleccionar manualmente la abertura en cualquier imagen decodificable, incluso sin ArUco o propuesta segura, y exige una acción explícita para analizar;
7. calcula la homografía desde las posiciones físicas de `LICHENDR-FRAME-0.2`;
8. produce exclusivamente la ventana de 400 × 2000 px (40 px/cm);
9. aplica controles de marcadores, homografía, resolución, desenfoque, exposición y reflejos;
10. guarda el original, los cuatro puntos, la rectificación, sus dimensiones, escala, área válida, método y flags bajo una ruta privada cuyo primer segmento es `auth.uid()`;
11. estima opcionalmente los dos bordes del tronco usando la abertura de 10 cm como referencia, sin bloquear por confianza baja;
12. crea un target de anotación inequívoco para la rectificación, pero no calcula cobertura.

Una condición crítica produce `repeat_photo`. Las cuatro vistas válidas llevan la serie a `capture_calibrated`; al continuar pasa a `annotation_pending`. MobileSAM y CIELAB se ejecutan en Annotation Studio sobre cada rectificación. Solo cuatro anotaciones `completed` producen `analysis_ready`; la revisión final cambia la serie a `completed`.

## Detección, confianza y confirmación

La detección automática usa primero la imagen original, limitada a 4096 px en su lado mayor, y después niveles únicos de hasta 3072, 2304, 1728 y 1152 px. Solo se clasifica como `validated` cuando aparecen los cuatro IDs, el cuadrilátero es seguro y el error RMS del ajuste del Board es como máximo 3 px canónicos.

Una detección parcial solo puede ofrecer una propuesta automática de esquinas si:

- existen tres marcadores distribuidos o el par diagonal 0–3/1–2; dos marcadores del mismo borde nunca bastan;
- el error del Board es como máximo 6 px canónicos;
- el contorno independiente de la abertura coincide con la proyección del Board, con IoU mínimo de 0.42 o distancia media de esquinas máxima del 5.5% de la diagonal;
- la propuesta queda sujeta a confirmación manual y nunca se acepta como medición automática validada.

Los cuatro controles manuales siempre corresponden, en orden, a las esquinas superior izquierda, superior derecha, inferior derecha e inferior izquierda de la abertura interior de 10 × 50 cm, nunca a los ArUco. Moverlos no envía solicitudes. **Confirmar 4 puntos y rectificar esta vista** bloquea los controles y calibra sin calcular líquenes. Un error conserva la fotografía y los puntos para corregir y reintentar.

Si las cuatro esquinas interiores son visibles, la selección se registra como `manual_confirmed` y es elegible para validación. Si alguna esquina o borde se estima, una confirmación adicional la registra como `manual_assisted_provisional` con `manual_estimated_geometry`; sus métricas son estimaciones, el total del árbol se identifica como provisional y la serie no puede confirmarse científicamente.

Toda selección confirmada debe mantener el orden superior izquierda, superior derecha, inferior derecha e inferior izquierda; ser convexa, no cruzada, quedar dentro de la fotografía, ocupar al menos 2500 px² o el 0.5% de la imagen, conservar una proporción observada entre 1:2.5 y 1:8 por la perspectiva y no tener bordes opuestos con una razón menor de 0.3. El método, clasificación, confianza automática previa, IDs, variante, dimensiones originales y cuatro coordenadas se conservan en la respuesta y en la fuente trazable de la vista sin cambiar el esquema. La selección revisada no entrena MobileSAM automáticamente.

Antes de cargar imágenes se confirman explícitamente el árbol y la jornada. Si una solicitud falla, las vistas ya guardadas permanecen en la serie y el reintento procesa solamente las vistas pendientes o fallidas con la misma clave idempotente. Una fotografía nueva crea un reemplazo trazable; una serie confirmada no se modifica.

## Fórmulas

Cada píxel canónico representa `500 cm² / (400 × 2000)`. Estas fórmulas se ejecutan únicamente después de finalizar las cuatro anotaciones:

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
La cobertura por vista y del árbol queda nula durante captura y mientras no existan cuatro anotaciones completas. Pintura, daño, musgo, alga, sombra, brillo, corteza y desconocido quedan excluidos de la unión de líquenes.

## Limitación científica

MobileSAM segmenta formas, pero no clasifica taxones. Los códigos `LQ-001`, `LQ-002`, etc. son **morfotipos visuales provisionales**, derivados de propuestas de máscara, color normalizado y textura. No son especies, riqueza taxonómica ni LDV. Sin fotografías de campo etiquetadas no se ha validado la capacidad de distinguir liquen, corteza y musgo de forma confiable.

## Codespaces

1. Aplicar las migraciones nuevas **solo al Supabase local**, incluida `supabase/migrations/202608100001_link_four_view_annotations.sql`.
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

`LICHENDR-FRAME-0.2` continúa siendo el marco obligatorio compatible. Una futura versión 0.3 podría evaluar marcadores físicamente mayores o ChArUco, pero no es requisito de este flujo ni sustituye los marcos ya impresos.

## Validación de campo pendiente

El URL temporal de la fotografía de diagnóstico devolvió HTTP 404 dentro del runner. No se incorporó el HEIC, metadatos EXIF/GPS ni una copia identificable, y no se creó una fixture artificial atribuida a esa imagen. Queda pendiente repetir manualmente el flujo completo con el archivo original disponible para confirmar la propuesta visual sobre esa fotografía concreta.
