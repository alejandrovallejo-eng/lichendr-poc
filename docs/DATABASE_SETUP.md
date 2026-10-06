# Base de datos real de LichenDR

Estado comprobado el 5 de octubre de 2026. La aplicación de esta rama está en
`apps/web`. Supabase almacena los proyectos, el muestreo, las anotaciones y las
fotografías privadas; Next.js conserva el frontend rediseñado.

## Instalación conectada

El proyecto alojado que ya estaba vinculado al repositorio existe y está sano.
Al conectar esta base, su historial contenía las **18 migraciones iniciales** de `supabase/migrations`, hasta
`202609160003_morphospecies_names.sql`. No se recreó ni reseteó la base.

La conexión local se completó con la clave **publishable** existente del mismo
proyecto. `apps/web/.env.local` permanece ignorado por Git, con permisos `600`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://<proyecto>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_<clave-publica>
LICHENDR_PREVIEW_ONLY=0
```

La configuración alojada ya habilitaba usuarios anónimos y Google. Se añadieron
solamente los callbacks locales exactos a la lista de retornos de Auth:

- `http://localhost:3000/auth/callback`
- `http://127.0.0.1:3000/auth/callback`

El Site URL y los callbacks alojados existentes se conservaron. Completar una
entrada con Google todavía requiere que el usuario elija su cuenta. Una sesión
anónima conserva datos en la nube, pero depende de ese navegador; la pantalla
`/cuenta` permite vincularla o recuperar una cuenta existente cuando está vacía.
No se unen ni transfieren proyectos entre cuentas automáticamente.

En Vercel, configurar la misma URL y clave pública para el entorno que deba usar
esta base y mantener `LICHENDR_PREVIEW_ONLY` ausente o en `0`. Reconstruir el
frontend después de cambiar variables públicas. La publicación final usa la base de trabajo por elección del propietario;
la base anterior de producción se conserva. Los datos alojados son reales;
no usar este proyecto como un sandbox general.

## Comprobación de funcionamiento

Abrir `/api/health/supabase` desde el navegador que tiene una sesión de LichenDR.
El endpoint ahora hace solicitudes reales y distingue:

- `ok`: usuario verificado, lectura de las 20 tablas/columnas requeridas y listado
  del almacenamiento del propio usuario correctos.
- `needs_session`: API accesible, pero tablas y Storage todavía no comprobados
  con una sesión válida. No crea usuarios al consultar su estado.
- `degraded`: la autenticación funciona, pero faltan tablas/columnas o falla Storage.
- `unavailable`: configuración o conectividad insuficientes.

La respuesta no incluye tokens, claves, fotografías, nombres de proyectos ni
identificadores de usuarios. No se cachea. Los sondeos no escriben y tienen un
presupuesto total de 12 segundos. Una lectura correcta no certifica por sí sola
escrituras, políticas completas, copias de seguridad ni disponibilidad de IA.

Desde `apps/web`:

```bash
npm run check:database
npm run test:database-readiness
```

El primer comando es de **solo lectura**. Sin una sesión en
`SUPABASE_CHECK_ACCESS_TOKEN` devuelve código `2` e informa `needs_session`;
no imprime ese token. Con problemas de conexión devuelve `1`; una comprobación
completa correcta devuelve `0`. El segundo comando verifica los diagnósticos sin
conectarse a Supabase.

Para una comprobación explícita de escritura:

```bash
npm run check:database -- --write
```

Este modo crea dos identidades anónimas de comprobación y datos sintéticos
identificados: proyecto → sitio → jornada → árbol → muestra → imagen de 8×8 →
metadatos → serie/vista. Comprueba relectura, descarga privada, URL firmada y
rechazo de lectura/escritura de otro usuario sobre estos registros y archivos.
También comprueba que la imagen no sea pública. Utiliza la clave pública y RLS;
no necesita credenciales administrativas ni fotografías personales.

Al terminar elimina **solo** su propia vista y proyecto sintéticos, con sus
dependencias, y su archivo. La vista se elimina antes que su imagen porque
`capture_views.image_id` usa `ON DELETE RESTRICT`. Las dos identidades anónimas
permanecen en Auth; no ejecutar este modo desde un health check ni periódicamente
en producción. Revisar cualquier error de limpieza antes de repetirlo.

La comprobación real de esta instalación pasó las 20 tablas, el recorrido de
escritura/recuperación y las denegaciones de acceso descritas. Los datos y archivos
sintéticos fueron retirados; los registros existentes se conservaron. No se
ejecutó MobileSAM, BioCLIP ni análisis científico como parte de esta verificación.

## Reproducir el esquema en otra instalación

Se añadió `supabase/config.toml`, compatible con CLI **2.119.0**, para que el
repositorio pueda inicializar su esquema mediante las migraciones versionadas.
Empieza vacío: no hay observaciones científicas de ejemplo ni seed automático.

Para una base alojada nueva, crear el proyecto en Supabase y después, desde la
raíz del repositorio:

```bash
npx --yes supabase@2.119.0 login
npx --yes supabase@2.119.0 link --project-ref <referencia-del-proyecto-nuevo>
npx --yes supabase@2.119.0 migration list
npx --yes supabase@2.119.0 db push --dry-run
npx --yes supabase@2.119.0 db push
```

Las credenciales se introducen en el flujo del CLI, nunca en Git ni como valores
literales de esos comandos. `db push` crea tablas, RPC, políticas RLS y el bucket
privado `lichen-images`, con límite de 20 MiB y tipos de imagen autorizados.
Configurar Auth anónimo, vinculación manual y Google para esa instalación; usar
callbacks exactos de su dominio. Copiar su URL y clave pública a Next.js.

En una base existente, comprobar primero el historial y aplicar únicamente las
migraciones pendientes. Varias migraciones no son reejecutables: no pegar las 18
completas sobre un esquema existente ni usar `db reset` contra datos alojados.

El archivo TOML describe el stack **local**; no cambia automáticamente las opciones
del proyecto alojado. Para levantarlo localmente se necesita Docker:

```bash
npx --yes supabase@2.119.0 start
```

Este Mac no tiene Docker instalado, por lo que no se arrancó un segundo stack ni
se validó aquí una instalación desde cero. La verificación real se realizó contra
la base alojada existente. La versión local de PostgreSQL es 17; comprobar la
versión remota antes de comparar esquemas entre ambos.

## Límites del primer paso

La base y el almacenamiento están conectados y comprobados. La preparación de
proxies de análisis sigue requiriendo `VISION_SERVICE_TOKEN`, y la inferencia
requiere los servicios de visión/BioCLIP. Al compartir Storage con el despliegue
alojado, utilizar el mismo token de firma que ese despliegue: un token local distinto
puede invalidar los manifiestos compartidos de imágenes existentes.

Antes de depender de la instalación para trabajo de campo definitivo, disponer de
un respaldo de la base **y de los bytes de Storage**, y comprobar su recuperación.
El dashboard actual no muestra backups programados. Una copia SQL no contiene
las fotografías. El módulo de exportación incorpora ahora una copia verificada de los datos
y fotografías de una cuenta, y un recuperador con sesión del mismo propietario.
Ver alcance, procedimiento, restricciones y estado de automatización en
[BACKUPS.md](BACKUPS.md).

Referencias: [migraciones](https://supabase.com/docs/guides/deployment/database-migrations),
[usuarios anónimos](https://supabase.com/docs/guides/auth/auth-anonymous),
[claves de API](https://supabase.com/docs/guides/api/api-keys) y
[variables de Next.js](https://nextjs.org/docs/app/guides/environment-variables).

## Conflictos de guardado

La integración final agrega `202610050001_review_conflicts_http409.sql`. Las tres
RPC de revisiones y nombres usan ahora `PT409` para conflictos de concurrencia
de la aplicación. Se conserva su definición, propietario, permisos y validación;
no se modifican registros científicos. El cliente reconoce tanto el código
antiguo `40001` como el nuevo `PT409`, conserva el borrador y pide revisar la
versión actual. La prueba real verifica una respuesta HTTP 409 inmediata, sin
reintentar una escritura desactualizada.
