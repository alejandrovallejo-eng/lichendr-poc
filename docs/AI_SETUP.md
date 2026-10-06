# Conexión de los motores de IA

La interfaz local usa MobileSAM en Render y BioCLIP en el Cloud Run privado
existente del proyecto Google Cloud `lichendr`. No hace falta instalar los
pesos de BioCLIP en esta Mac. Las credenciales permanecen en el servidor;
el navegador llama a las rutas autenticadas de Next.js.

## Configuración local

En `apps/web/.env.local`, protegido e ignorado por Git:

```dotenv
LICHENDR_PREVIEW_ONLY=0
VISION_SERVICE_URL=https://lichendr-vision-preview.onrender.com
VISION_SERVICE_TOKEN=<secreto existente del servicio Render>
NEXT_PUBLIC_MOBILESAM_ASSISTANCE=1
NEXT_PUBLIC_BIOCLIP_SUGGESTIONS=1
BIOCLIP_WORKER_URL=https://lichendr-bioclip-preview-5ccbk3mcba-ue.a.run.app
BIOCLIP_WORKER_TOKEN=<versión vigente de lichendr-bioclip-preview-token>
BIOCLIP_PREPROCESS_MODE=standard_center_crop
BIOCLIP_GOOGLE_IAM=0
BIOCLIP_GOOGLE_DEVELOPER_AUTH=1
BIOCLIP_GCLOUD_PATH=/Users/alejandro/.local/share/lichendr/google-cloud-sdk/bin/gcloud
```

Mantener también las dos variables públicas de Supabase documentadas en
[DATABASE_SETUP.md](DATABASE_SETUP.md). Reutilizar el mismo
`VISION_SERVICE_TOKEN` al compartir Storage: también firma los manifiestos de
las fotografías preparadas. No reemplazarlo solamente en la aplicación local.

Google Cloud CLI debe estar autenticado con una cuenta que ya pueda invocar
el servicio. En esta Mac el SDK utiliza Python 3.11 mediante `CLOUDSDK_PYTHON`
en el archivo local. Para volver a iniciar sesión:

```bash
export CLOUDSDK_PYTHON="$HOME/.local/share/uv/python/cpython-3.11-macos-aarch64-none/bin/python3.11"
"$HOME/.local/share/lichendr/google-cloud-sdk/bin/gcloud" auth login
```

El adaptador local obtiene una identidad temporal por solicitud y la envía
como `X-Serverless-Authorization` únicamente a `/health` y `/suggest-regions`
del Cloud Run aprobado. El token propio del worker sigue en `Authorization`.
No crea una clave de cuenta de servicio ni hace público el worker. Los errores
de autenticación indican que se debe recuperar la sesión del SDK.

El arranque conectado reproducible es `npm run dev:full`, desde `apps/web`.
Valida la configuración y conserva una instancia de este proyecto que ya esté
abierta en el puerto 3000. No instala Torch ni arranca otro worker cuando se
utilizan los servicios alojados. Para un worker ONNX local opcional, usar
`scripts/setup-vision-service.sh` y `scripts/dev-with-vision.sh`, con Python 3.11;
el entorno de exportación de modelos está separado del runtime.

Reiniciar `npm run dev` después de modificar variables. La opción pública de
sugerencias se incorpora al código del navegador al compilar.

## Flujo

1. La fotografía original se guarda en Storage privado.
2. Next.js comprueba la sesión y propiedad, prepara una copia JPEG orientada
   y acotada, y firma su manifiesto.
3. MobileSAM prepara la imagen y propone máscaras a partir de puntos.
4. BioCLIP clasifica los recortes de las regiones mediante la cabeza entrenada.
5. El usuario revisa las sugerencias antes de incorporarlas al análisis. La
   comparación experimental de cinco clases se presenta por separado.

La integración técnica no convierte una sugerencia en identificación científica
confirmada. Si falla la preparación, la interfaz conserva la fotografía original,
explica el problema y permite volver a abrirla sin subirla otra vez.

## Verificación reproducible

Con la aplicación local encendida, desde `apps/web`:

```bash
npm run check:ai
npm run check:ai -- --workflow --image /ruta/a/una/fotografia.jpg
npm run test:bioclip-auth
```

La primera orden comprueba que MobileSAM esté cargado, esperando de forma
acotada el arranque. La segunda ejecuta las rutas reales de preparación,
segmentación, clasificación y comparación experimental usando un propietario,
árbol, vista y fotografía temporales. Elimina sus registros y archivos y libera
su sesión MobileSAM; la identidad anónima queda en Supabase Auth. No modifica
los proyectos ni revisiones existentes. Sin `--image` usa una imagen sintética
para comprobar transporte y contratos, sin evaluar calidad biológica.

El verificador solo permite `AI_CHECK_APP_URL` en localhost. No repite solicitudes
de inferencia después de un timeout. Un resultado de `/health` por sí solo no
demuestra que la segmentación o clasificación funcionen.

El 5 de octubre de 2026 esta verificación pasó con una fotografía del flujo:
copia privada firmada, tres máscaras MobileSAM, una sugerencia BioCLIP con
tres etiquetas de la cabeza entrenada y comparación
`inat-five-class-20260917`. Se liberó la sesión y se retiraron los registros
y archivos temporales. También pasaron las 14 pruebas de autenticación y
la compilación de producción con Webpack.
Después se reintentó la consulta sobre la selección existente de la fotografía
Norte del usuario: el flujo mostró «1/1 ejemplos sugieren liquen» y avanzó a
«Revisa y guarda». Se dejó la confirmación final de la vista al usuario.

## Vercel y separación de datos

Vercel mantiene su autenticación federada existente con
`BIOCLIP_GOOGLE_IAM=1`; allí `BIOCLIP_GOOGLE_DEVELOPER_AUTH` debe estar apagado.
No necesita el SDK ni las credenciales personales de esta Mac.

Por elección del propietario, la base de trabajo `taqdmdghdqnczioxhajb` se usa
también para la publicación final. La antigua base `nioqaweibbtwxwpipqpe` se
conserva sin borrar ni trasladar registros. Una sesión pertenece a su base; no
reenviarla a un despliegue configurado con otra URL de Supabase.

## Capacidades y verificación completa

`NEXT_PUBLIC_MOBILESAM_ASSISTANCE=0` desactiva la ayuda de segmentación de
regiones. `NEXT_PUBLIC_BIOCLIP_SUGGESTIONS=0` desactiva la clasificación, sin
desactivar MobileSAM. `/api/vision/capabilities` requiere sesión y devuelve
solamente indicadores de configuración. La disponibilidad real se comprueba
con inferencia; una configuración correcta puede tener un worker dormido.

```bash
npm run check:workflow -- --image /ruta/arbol.jpg
# Destino de producción explícito y acotado al dominio de este proyecto:
npm run check:workflow -- --production --image /ruta/arbol.jpg
```

Este recorrido crea un propietario temporal, cuatro vistas, preparaciones,
selección de cobertura técnica, sugerencias reales BioCLIP y una sesión MobileSAM.
Comprueba guardado y relectura, conflictos de revisión, cuadrantes, exportaciones,
aislación entre cuentas y una recuperación real de su copia, comparando los
bytes con SHA-256. Retira únicamente sus datos y archivos; las identidades
anónimas de comprobación permanecen en Auth. Sus etiquetas de color son datos
de prueba, no una evaluación biológica. No ejecutarlo como health check ni
programarlo periódicamente contra datos usados.

`npm test` ahora incluye los recorridos de componentes, resultados, colores,
ecológica, cierre de jornada, exportaciones y respaldo. Para no omitir el caso
HEIC de 48 MP, usar Python 3.11 con `pillow-heif==0.21.0` y `Pillow==12.3.0`
y señalar ese ejecutable con `PYTHON_BIN`. El workflow de CI instala esas
dependencias y compila también el runtime Sharp del despliegue.
