# LichenDR — actualización 0.2

Prototipo interactivo de biomonitoreo de líquenes para la República Dominicana.

## Actualizar el proyecto en GitHub Codespaces

1. Detén la aplicación anterior con `Ctrl+C` en la terminal.
2. Coloca `LichenDR_Update_0.2.zip` en la carpeta principal del proyecto.
3. Ejecuta:

```bash
unzip -o LichenDR_Update_0.2.zip
python -m pip install -r requirements.txt
python -m streamlit run app.py --server.address 0.0.0.0
```

4. Cuando Codespaces muestre el puerto, selecciona **Open in Browser**.

## Flujo de trabajo

1. Crea un **sitio de muestreo** con nombre, centro GPS y radio.
2. Crea el primer **árbol o sustrato**.
3. Añade una o varias **imágenes del mismo árbol**.
4. Revisa la fecha y el GPS extraídos de EXIF.
5. Confirma la ubicación o introduce coordenadas manualmente.
6. Define el rectángulo de corteza que se analizará.
7. Clasifica los 50 puntos fijos para estimar cobertura.
8. Crea morfotipos visuales M1, M2, M3, etc., y marca ejemplos en la foto.
9. Guarda la imagen y añade otra imagen del mismo árbol o finaliza el árbol.
10. Añade más árboles al mismo sitio.
11. Revisa el resumen dentro del radio y exporta los datos.

## Dos tipos de puntos

- **Cuadrícula de cobertura:** la aplicación genera 50 puntos fijos. Cada punto se
  clasifica como liquen, corteza, musgo, alga, sombra, reflejo, desconocido o
  fuera del tronco. Estos puntos sí se utilizan para calcular la cobertura.
- **Puntos de morfotipos:** el usuario coloca ejemplos libres de M1, M2, M3, etc.
  Sirven para documentar tipos visualmente distintos, pero no para calcular
  cobertura.

La cobertura se calcula como:

```text
cobertura (%) = puntos de liquen / puntos evaluables × 100
```

## Qué incluye

- Jerarquía **sitio → árboles → imágenes**.
- Nombre libre para cada sitio y árbol.
- Radios de 50 m, 100 m, 250 m, 500 m y 1 km.
- Carga múltiple de JPG, PNG, HEIC y HEIF.
- Extracción real de fecha, cámara, GPS, altitud y precisión EXIF cuando existen.
- Confirmación manual de fecha y coordenadas.
- Mapa y comprobación de cada árbol contra el radio.
- Anotación interactiva de cobertura y morfotipos.
- Guardado local de imágenes, metadata y anotaciones.
- Resumen por árbol y por sitio.
- CSV por imagen, por árbol y por punto.
- Respaldo completo de metadata y anotaciones en JSON.

## Dónde se guardan los datos

Al pulsar **Guardar**, el prototipo crea:

```text
data/
├── lichendr_local.json
└── images/
```

No borres esa carpeta si quieres conservar el trabajo dentro del Codespace.
También conviene descargar el respaldo JSON desde la pantalla **Exportar**.

## Límites científicos de esta versión

- M1, M2, M3 son morfotipos visuales, no especies confirmadas.
- Los códigos son comparables entre imágenes del mismo árbol.
- Los códigos de árboles distintos todavía no se reconcilian automáticamente.
- El resumen del sitio exige al menos 5 árboles dentro del radio y 10 imágenes
  válidas antes de habilitar una señal ambiental provisional.
- Todavía no existe identificación automática de especies ni una estimación
  ambiental calibrada para la República Dominicana.

