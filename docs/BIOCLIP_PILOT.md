# Piloto revisable BioCLIP 2 + MobileSAM

Estado: **piloto detrás de un flag apagado por defecto**. No cambia Producción,
ni RLS, ni secretos, ni servicios desplegados, ni las fórmulas ambientales
existentes.

## Qué hace y qué NO hace

MobileSAM **propone** regiones, BioCLIP 2 **sugiere** una de tres etiquetas
(`lichen`, `moss`, `bare tree bark`) y una persona **revisa** antes de que se
cuente cobertura.

- Clasificar una fotografía **no** es segmentarla, **no** identifica especie y
  **no** estima calidad del aire.
- Las puntuaciones son **crudas**, no probabilidades, y no se umbralizan.
- La puntuación de MobileSAM mide calidad de máscara, **no** presencia de liquen.
- Una región puede mezclar sustratos: la etiqueta **no** demuestra que todos sus
  píxeles sean liquen.
- Que no se propongan regiones **no** demuestra ausencia de líquenes: antes de
  finalizar hay que revisar la completitud del ROI y añadir máscaras omitidas.
- Sin calibración el porcentaje es **exploratorio**: no equivale a cm², no indica
  calidad del aire, no permite comparar árboles científicamente y queda excluido
  de los agregados científicos.

## Evidencia local disponible (del revisor)

- BioCLIP 2 congelado + Ridge entrenado con 64 fotos; 16 nuevas reservadas (solo
  2 negativos de corteza) y 20 de regresión conocida.
- Ridge ampliado 16/16 en el nuevo conjunto, pero *zero-shot* también 16/16, y
  persiste un falso positivo en un recorte de control sin líquenes.
- De ahí que **no** se afirme precisión general ni se ajusten umbrales con ese
  ensayo, y que las máscaras sigan **sin validación experta**.
- Pico real de memoria observado en CPU: **~3–3.3 GiB**. Por eso BioCLIP/PyTorch
  **no** se añaden al servicio ONNX de 512 MB (`services/vision`), que queda
  intacto.

## Corrección de la revisión `ce47457`

La primera versión del panel usaba **SlimSAM en el navegador**
(`modules/vision-lab`), descartaba las máscaras dibujando solo cajas y "editar
máscara" cambiaba únicamente un booleano. Ya no:

- las regiones vienen del **MobileSAM `vit_t` del servicio** `services/vision`,
  a través de las rutas existentes `/api/vision/prepare`, `/api/vision/segment` y
  `/api/vision/sessions/:id`;
- las **máscaras reales** se conservan (RLE binario validado), se dibujan píxel a
  píxel en el overlay y son las que se miden;
- el **editor cambia píxeles** (pincel añadir/borrar); `maskEdited` se deriva de
  una diferencia real de píxeles y el hash de la máscara se recalcula, de modo
  que una decisión humana no se conserva solo por `regionId` si la máscara cambió.

### Smoke real ejecutado por el revisor (local, fotos privadas no publicadas)

MobileSAM `vit_t` + BioCLIP 2 + cabeza Ridge, con Python 3.12 / torch 2.14 /
open_clip 3.3 (runtime local del revisor, **distinto** del *lock* de este PR):

| ensayo | propuestas | ranking | tiempo | RSS pico |
| --- | --- | --- | --- | --- |
| fotografía positiva | 5 regiones | 4 liquen, 1 musgo | 3,7 s | ~2213 MiB (2 hilos CPU) |
| control negativo | 2 regiones | corteza | 3,4 s | — |

Limitación honesta: **el overlay positivo incluye fondo y ramas**, así que ese
ensayo *no* valida la cobertura. No se ha reentrenado ni se han ajustado umbrales
con esas fotografías, que no son accesibles en este entorno.

## Arquitectura del piloto

- `services/bioclip/`: worker **local** aislado (FastAPI). Desactivado salvo
  `BIOCLIP_WORKER_ENABLED=1`, dependencias fijadas, modelo cargado una sola vez,
  concurrencia 1, cola acotada, timeout y límites de bytes/píxeles/regiones.
  No se abre ningún túnel ni se publica el worker.
- `apps/web/src/app/api/vision/region-suggestions/route.ts`: única ruta nueva.
  Recibe **solo referencias pequeñas** (identificadores y recuadros enteros),
  valida sesión/propiedad/bucket/ruta/MIME/tamaño reutilizando
  `vision-analysis-proxy`, corta los recortes en el servidor desde el proxy
  privado y llama al worker local. Nunca acepta una URL arbitraria (sin SSRF) y
  ni las credenciales ni las URLs firmadas salen en UI, resultados o logs.
- `apps/web/src/modules/region-suggestions/`: lógica pura (códec y edición de
  máscaras, geometría de recortes, revisión, cobertura, flag) y panel de revisión
  en español.

### Contrato único de geometría y EXIF

La orientación EXIF se aplica **una sola vez, aguas arriba**: el proxy se genera
con `sharp .rotate()` y el servicio de visión decodifica con `exif_transpose`.
Máscaras y proxy comparten por tanto el mismo espacio canónico y solo difieren en
escala, así que el piloto **nunca vuelve a rotar coordenadas**.

- el cliente mide la caja **ajustada** de la máscara sobre la rejilla de trabajo
  y envía esa caja más las dimensiones de la rejilla;
- el servidor la escala a píxeles del proxy y aplica el margen de contexto
  **exactamente una vez**, al cortar el recorte;
- el servidor devuelve `cropBoxNormalized` y el overlay dibuja ese recorte, de
  modo que lo que se ve es lo que vio BioCLIP.

Antes la caja se expandía en el cliente **y** otra vez en `cutCrops`, y el panel
fijaba `orientation=1`/`proxyScale=1` sobre el original mientras la ruta recortaba
el proxy.

### Guardas de contexto y validación de la serie

- cada ejecución incrementa una **generación** guardada en una `ref`; al volver de
  cada `await` se compara contra la generación **viva** y se usa un
  `AbortController`. Comparar el contexto capturado con su propio eco siempre
  coincidiría y dejaría que una respuesta vieja pisara la serie activa;
- al cambiar de propietario/árbol/vista/imagen el panel **limpia** su estado;
- la persistencia se indexa por propietario + árbol + vista + imagen y las
  revisiones se re-anclan por **hash de píxeles de la máscara**;
- el servidor valida la asociación **imagen–vista–`tree_sample`** y que las
  **cuatro** vistas N/E/S/O tengan original y proxy listos antes de inferir;
- las peticiones se atienden con un **coordinador serial** compartido, no con
  cuatro trabajos en paralelo.

### Caché real, no una clave devuelta

Devolver una `cacheKey` después de inferir no es caché. Ahora hay **reutilización
acotada de verdad**: la entrada se consulta antes de inferir y se escribe después,
en un LRU en memoria acotado por propietario. La clave incluye propietario, hash
de los **bytes del proxy**, hash de los **píxeles de las máscaras**, encoder,
cabeza, preprocesado y versiones. La firma del manifiesto es un HMAC de metadatos,
**no** un SHA de la imagen, y ya no se usa como tal.

## Modelo: descarga explícita y verificada

Encoder `imageomics/bioclip-2`, revisión
`2957b322090f9cb17ae72c71981c7218a28d81e0`.
`open_clip_model.safetensors`: SHA256
`b7b2bf6fbc95799e42630e394cf95803892ab447c1a8ab629dbc82fbeaf7dfef`,
`1710517724` bytes.

La descarga es un paso manual explícito (`python download_model.py`), verificada
por tamaño y SHA256 antes de promover el archivo. **Nunca** ocurre durante
`next build` ni por una petición HTTP. Se usa configuración oficial y
*safetensors*, sin ejecutar código remoto arbitrario, y se conservan los ficheros
de licencia descargados. Referencia:
<https://imageomics.github.io/pybioclip/python-tutorial/#lightweight-classifiers>.

## Base zero-shot reproducible

- Etiquetas exactas en inglés: `lichen`, `moss`, `bare tree bark`.
- Prompts fijos: `"a photo of {label}."` y `"a close-up photo of {label}."`.
- Normalización/agregación: se codifican los 6 prompts, se normalizan L2, se
  promedian por etiqueta y se vuelve a normalizar; la puntuación es el coseno
  contra el embedding L2 del recorte. Solo se ordena; no hay umbrales.
- El backend usado (`zeroshot` o `ridge_head`) se registra en cada resultado.

## Cabeza entrenada opcional (NPZ)

La cabeza real **solo existe en el Mac del revisor**; aquí no está adjunta ni
accesible, y no se ha inventado ningún peso. El cargador
(`services/bioclip/head.py`) acepta un NPZ con `allow_pickle=False` y valida
esquema, dimensiones, finitud, clases, hash y compatibilidad con el encoder:

| clave          | forma     |
| -------------- | --------- |
| `weights`      | `(768,3)` |
| `feature_mean` | `(768,)`  |
| `intercept`    | `(3,)`    |
| `centroids`    | `(3,768)` |
| `labels`       | `['lichen','moss','bark']` (ese orden exacto) |

`bark` es el identificador interno; `bare tree bark` es solo el texto del prompt.
Embeddings L2 normalizados; `ridge = (X - feature_mean) @ weights + intercept` y
`centroid = X @ centroids.T`.

SHA256 del NPZ local del revisor:
`1fbef280fbc574488996c50cdecf83fc05636366c4b4520581f6da3707e4a33e`.

Uso opcional:

```bash
BIOCLIP_HEAD_PATH=/ruta/local/head.npz \
BIOCLIP_HEAD_SHA256=1fbef280fbc574488996c50cdecf83fc05636366c4b4520581f6da3707e4a33e \
BIOCLIP_WORKER_ENABLED=1 python -m uvicorn app:app --port 8500
```

Si **no** se configura cabeza, el *zero-shot* funciona igual y el backend queda
registrado como `zeroshot`. Si se configura una cabeza y **no** valida, el worker
responde `503 head_invalid` y la ruta lo traduce a un aviso explícito en la UI:
nunca degrada en silencio a *zero-shot* cuando se pidió la cabeza entrenada.

## Comandos exactos

Worker local (en el Mac del revisor, nunca en Producción):

```bash
cd services/bioclip
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python download_model.py --dest ./models/bioclip-2      # descarga verificada
python download_model.py --dest ./models/bioclip-2 --verify-only
BIOCLIP_WORKER_ENABLED=1 BIOCLIP_MODEL_DIR=./models/bioclip-2 \
  python -m uvicorn app:app --host 127.0.0.1 --port 8500
```

Smoke CLI real MobileSAM → BioCLIP con fotos locales (genera overlay,
etiquetas/puntuaciones crudas, tiempos y RSS):

```bash
cd services/bioclip
python smoke_cli.py \
  --image /ruta/local/foto1.jpg --image /ruta/local/foto2.jpg \
  --mobile-sam-checkpoint /ruta/local/mobile_sam.pt \
  --model-dir ./models/bioclip-2 \
  --out /ruta/local/salida
# opcional, con la cabeza real:
#   --head /ruta/local/head.npz \
#   --head-sha256 1fbef280fbc574488996c50cdecf83fc05636366c4b4520581f6da3707e4a33e
```

UI contra ambos servicios (ONNX ya existente + worker BioCLIP local):

```bash
cd apps/web
cp .env.example .env.local   # rellena tus propios valores, sin credenciales falsas
# en .env.local:
#   NEXT_PUBLIC_BIOCLIP_SUGGESTIONS=1
#   BIOCLIP_WORKER_URL=http://127.0.0.1:8500
#   BIOCLIP_WORKER_TOKEN=<token propio del worker local>
npm ci && npm run dev
```

Con `NEXT_PUBLIC_BIOCLIP_SUGGESTIONS` distinto de `1` el panel no se renderiza,
el cliente no llama a la ruta y la ruta rechaza la petición: cero llamadas a
BioCLIP y ninguna regresión.

## Pruebas

```bash
cd apps/web && npm run test:unit && npm run lint && npm run build
cd services/bioclip && python -m pytest tests -q
```

### Límites y concurrencia del worker

- el tamaño del cuerpo se acota por los **bytes realmente recibidos** (una
  petición *chunked* no declara `Content-Length`, así que ese encabezado por sí
  solo no acota nada);
- la **admisión ocurre antes de decodificar**: cola, bytes agregados y píxeles
  agregados se comprueban leyendo solo la cabecera de cada imagen;
- el encoder procesa **microlotes** en vez del lote entero;
- los topes agregados de la ruta y del worker están alineados (8 MiB y 24 MPx);
- **bug corregido**: `asyncio.wait_for` solo cancela la espera; el hilo de
  `asyncio.to_thread` seguía corriendo, así que liberar el semáforo al expirar el
  plazo admitía una segunda inferencia (pico de 2 con concurrencia prometida de
  1). Ahora el plazo incluye la espera en cola y el semáforo se libera solo
  cuando el trabajo termina de verdad. Hay test de regresión de "máximo 1".

## Limitaciones y decisiones pendientes

- **Hosting sin decidir**: dónde vivirá el worker (Mac del revisor, máquina
  dedicada, contenedor con ≥4 GiB) es una decisión abierta. No se ha contratado
  ni desplegado nada, y una *preview* que compila **no** prueba inferencia
  BioCLIP remota sin host.
- **Persistencia**: la restauración tras recarga usa almacenamiento local
  acotado al propietario. No se añade migración ni se toca RLS; la persistencia
  duradera queda como decisión abierta.
- **Cobertura**: el ROI es el tronco que confirma la persona revisora. Las
  propuestas de MobileSAM no demuestran liquen píxel a píxel, así que la cobertura
  solo suma la **unión** de máscaras aceptadas como liquen intersectada con el
  ROI, sin doble conteo, y solo se puede finalizar sin regiones pendientes y con
  la completitud del ROI revisada.
- Mocks y datos sintéticos prueban el software, **no** la precisión biológica.
  Sin fotos ni pesos privados en este entorno, la inferencia real la ejecutó el
  revisor en local (ver más arriba); aquí solo se validó el software.
