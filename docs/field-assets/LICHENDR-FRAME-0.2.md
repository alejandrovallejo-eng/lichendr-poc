# Especificación técnica LICHENDR-FRAME-0.2

Imprimir **a tamaño real / 100%**, sin “ajustar a página”. La ventana interior mide exactamente **100 × 500 mm** y se divide en cinco celdas de **100 × 100 mm**.

## Geometría

El origen físico `(0, 0)` está en la esquina superior izquierda del marco completo de 180 × 580 mm.

| Elemento | X (mm) | Y (mm) | Ancho (mm) | Alto (mm) |
|---|---:|---:|---:|---:|
| Ventana interior | 40 | 40 | 100 | 500 |
| ArUco ID 0, superior izquierdo | 15 | 15 | 20 | 20 |
| ArUco ID 1, superior derecho | 145 | 15 | 20 | 20 |
| ArUco ID 2, inferior izquierdo | 15 | 545 | 20 | 20 |
| ArUco ID 3, inferior derecho | 145 | 545 | 20 | 20 |

Los cuatro marcadores pertenecen al diccionario OpenCV `DICT_5X5_50`. Sus centros físicos son `(25,25)`, `(155,25)`, `(25,555)` y `(155,555)` mm. El reconocimiento usa ArUco; no depende de OCR.

La plantilla incluye referencias visuales blanca, gris y negra, además de una barra física de 100 mm. Antes del trabajo de campo se debe medir la barra y los lados de la ventana con una regla; una desviación superior a 1 mm requiere reimprimir.

## Archivos

- `lichendr-frame-0.2-plotter.pdf`: página vectorial de 180 × 580 mm.
- `lichendr-frame-0.2-a4-3pages.pdf`: tres páginas A4 con 2.5 mm de solape.
- `lichendr-frame-0.2-spec.json`: geometría legible por código.

Regenerar desde la raíz:

```bash
python scripts/generate-lichen-frame.py
```

Para ensamblar las páginas A4, recortar solo el margen exterior, superponer 2.5 mm, alinear las líneas de la ventana y comprobar la barra de 10 cm. No escalar ninguna página.
