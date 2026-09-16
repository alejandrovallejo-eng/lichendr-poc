# Revisión y cierre de jornada

Entrada: Jornada → **Revisar y cerrar jornada**. Resultados también enlaza a la jornada.
La revisión sustituye la lista de árboles en la misma pantalla; Volver restaura la lista.

El cierre es **administrativo, reversible y no bloquea ediciones**. Reutiliza
`sampling_events.status` (`draft` = abierta, `completed` = cerrada). No equivale a
validación científica, evaluación ecológica completa ni calidad del aire. No es
una instantánea inmutable: el resumen siempre muestra los datos guardados actuales.
No hay nuevas tablas, migraciones, modelos, llamadas a IA ni cambios en RLS.

Cada árbol mantiene sus cuatro vistas N/E/S/O. Sin foto, sin guardar y guardado
inválido son pendientes distintos, nunca ceros de cobertura. Un 0% guardado sí es
un resultado. No se promedian ni suman porcentajes de fotos. Los cuadrantes
ecológicos son independientes, opcionales para este cierre.

Una jornada vacía no puede cerrarse. Con pendientes se exige reconocimiento
explícito; todos permanecen visibles después de cerrar. Reabrir no altera datos.
No se escriben fotos, máscaras, colores, anotaciones, métricas ni catálogos.

La lectura exige sesión actual y RLS del propietario, pagina las muestras y
verifica que ninguna se haya omitido del resumen. Carga/error no habilitan cierre.
Antes de cambiar el estado se relee la jornada: cambios de imagen, resultados,
árboles o estado requieren otra revisión. La actualización compara id, sitio,
estado y updated_at (CAS); respuesta vacía/fallida no significa éxito. Ante una
respuesta ambigua se exige actualizar antes de reintentar. Doble clic bloqueado.
Esto no pretende una transacción/snapshot de todos los hijos: otros editores pueden
seguir guardando durante o después del cierre administrativo.

Pruebas: `node node_modules/typescript/bin/tsc -p tsconfig.jornada-closure-tests.json`
y `NODE_PATH=$PWD/node_modules node --test /tmp/lichendr-jornada-closure-tests/modules/jornada/closure.test.js`.
