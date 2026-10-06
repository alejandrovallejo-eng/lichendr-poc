# Verificación de la integración final

Comprobado localmente el 5 de octubre de 2026, con el código de `1e26fb1`.
Publicado y comprobado en Production el 6 de octubre de 2026, con el commit
`dbb8e6f`, despliegue Vercel `2Mo3MetTxDE7bpgQYk5T14DwYMPg`.

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
| Configuración alojada | Vercel Production usa la base elegida `taqdmdghdqnczioxhajb`; callback exacto y Site URL finales guardados; base anterior conservada | Publicada |
| Publicación del código | GitHub CLI autorizado por el propietario; `v1-modular` publicado, compilación Production y dominio final Ready | Correcto |
| CI remoto | [GitHub Actions](https://github.com/alejandrovallejo-eng/lichendr-poc/actions/runs/37476012831): 439 pruebas sin fallos ni omisiones y compilación correcta | Correcto |
| Validación de la web publicada | `npm run check:workflow -- --production`: MobileSAM, BioCLIP privado mediante identidad Vercel/Google, cuatro vistas, concurrencia, cierre, CSV/JSON, aislamiento y recuperación real verificados | Correcto |
| Entrada con Google en Production | Cuenta permanente recuperada mediante Google, callback exacto al dominio final y proyecto previo visible | Correcto |
| Recuperación del trabajo de la sesión local | La sesión local anónima y la cuenta Google existente pertenecen a dos usuarios distintos. Supabase rechaza el vínculo con `identity_already_exists`; la sesión y el proyecto originales se conservaron. Requiere elegir entre copiar el proyecto a la cuenta permanente o vincular otra identidad disponible | Pendiente de decisión del propietario |
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
