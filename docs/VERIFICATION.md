# Verificación de la integración final

Comprobado localmente el 5 de octubre de 2026, con el código de `1e26fb1`.

| Recorrido | Evidencia | Estado |
|---|---|---|
| Pruebas automatizadas | `npm test`, Python 3.11 para HEIC: 439 pruebas, 0 fallos, 0 omitidas | Correcto |
| Compilación | `npm run build -- --webpack`, runtime Sharp/libvips Linux verificado | Correcto |
| Código de capacidades y exportaciones | TypeScript y ESLint de los módulos modificados de capacidades, captura y exportación | Correcto |
| Imágenes | JPEG orientado, PNG y HEIC de 48 MP en los casos pertinentes | Correcto |
| MobileSAM real | Preparación privada, máscaras por punto y liberación de sesión | Correcto |
| BioCLIP real | Clasificación por la cabeza entrenada en las cuatro orientaciones; sugerencias pendientes de revisión | Correcto |
| Cuatro vistas | Originales, proxies, cobertura técnica, guardado/relectura y conflicto HTTP 409 | Correcto |
| Cuadrantes y catálogo | Guardado y conflictos de concurrencia; nombres conservados | Correcto |
| Jornada | Cierre explícito y relectura; no modifica las revisiones | Correcto |
| Exportación | CSV coincide con los resultados por vista; JSON contiene las 20 tablas del propietario | Correcto |
| Aislamiento | Una segunda identidad autenticada no puede leer el proyecto temporal | Correcto |
| Recuperación | Proyecto temporal recuperado: 20 tablas, 8 archivos, revisiones y SHA-256; proxies reconstruidos al reabrir sin perder revisiones | Correcto |
| Datos del usuario | Copia de 20 tablas y 4 archivos existentes, descargada desde la interfaz y comprobada con el verificador local | Correcto |
| Móvil | Navegación, exportación y resultados a 390×844; ancho del documento 390, sin desbordamiento horizontal | Correcto |
| Configuración alojada | Vercel Production usa la base elegida `taqdmdghdqnczioxhajb`; callback exacto y Site URL finales guardados; base anterior conservada | Preparada para nuevo despliegue |
| Publicación del código | Commit local listo; el envío requiere autenticación de escritura de GitHub en esta Mac | Pendiente de autorización |
| Validación de la web publicada | Mismo recorrido con `npm run check:workflow -- --production` | Pendiente de publicación |
| Copia administrativa programada | Requiere credenciales PostgreSQL/Storage y recuperación en un destino aislado | Pendiente de acceso administrativo |

El recorrido real creó únicamente identidades y registros temporales. Sus vistas,
proyectos, dependencias y archivos fueron retirados. Las identidades anónimas
permanecen en Auth. No se modificaron las observaciones, selecciones de color ni
anotaciones del usuario.

Las pruebas de integración verifican ejecución, contratos, privacidad y
persistencia. Las selecciones de color de prueba no son verdad biológica. No se
certifica identificación de especies ni un índice de calidad del aire. El modelo
experimental de cinco clases permanece como comparación separada y voluntaria.

La recuperación mediante sesión de usuario tiene restricciones para historial
inactivo y recrea revisiones de concurrencia ecológicas mediante RPC. La copia
manual de una cuenta no sustituye un respaldo administrativo programado. Ver
[BACKUPS.md](BACKUPS.md).

## Repetir las comprobaciones

Desde `apps/web`, con la aplicación configurada y abierta:

```bash
npm run dev:full
npm run check:workflow -- --image /ruta/fotografia.jpg
npm test
npm run build -- --webpack
```

Para no omitir el fixture HEIC, `PYTHON_BIN` debe señalar Python 3.11 con
`pillow-heif==0.21.0` y `Pillow==12.3.0`; CI lo configura automáticamente.
No ejecutar la prueba de escritura como sondeo periódico. Ver
[AI_SETUP.md](AI_SETUP.md) para destinos y efectos de las comprobaciones.
