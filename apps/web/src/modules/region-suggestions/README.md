# `region-suggestions`

Lógica y UI del piloto revisable BioCLIP + MobileSAM. Documentación completa,
evidencia y limitaciones: [`docs/BIOCLIP_PILOT.md`](../../../../docs/BIOCLIP_PILOT.md).

| archivo | responsabilidad |
| --- | --- |
| `types.ts` | Etiquetas, decisiones, cadena de transformaciones, procedencia. |
| `flag.ts` | Flag `NEXT_PUBLIC_BIOCLIP_SUGGESTIONS`, apagado por defecto. |
| `crop-geometry.ts` | Caja de la máscara, contexto y escalado entre espacios de coordenadas (EXIF ya aplicado aguas arriba). |
| `mask-codec.ts` | Códec RLE de máscaras binarias con validación estricta. |
| `mask-edit.ts` | Edición real de píxeles (pincel añadir/borrar) y lectura de la máscara PNG del servicio. |
| `sam-service.ts` | Cliente del **MobileSAM `vit_t` del servicio**, no del SlimSAM del navegador. Envía una **referencia de imagen**, nunca el original. |
| `server/` | Recorrido en el servidor: autorización y series listas (`context.ts`), coordinador serial por instancia (`serial.ts`), ticket firmado de sesión SAM (`session-ticket.ts`), preparación desde el proxy (`sam-sessions.ts`, `sam-handlers.ts`), identidad verificada del worker (`identity.ts`) y sugerencias (`suggest.ts`). Las rutas de `app/api` son adaptadores finos. |
| `review.ts` | Clave de caché/idempotencia, fusión que nunca sobrescribe decisiones humanas, guardas de contexto, fases. |
| `coverage.ts` | Cobertura revisada por unión ∩ ROI, exploratoria y excluida de agregados científicos. |
| `client.ts` | Rejilla fija de prompts, conversión de máscaras a regiones y llamada a la ruta. |
| `storage.ts` | Restauración tras recarga acotada al propietario, sin migración ni cambios de RLS. |
| `RegionSuggestionsPanel.tsx` | Panel en español: Buscando regiones → Sugiriendo etiquetas → Revisar. |

Invariantes:

- Las regiones vienen de MobileSAM (`services/vision`) y sus **máscaras reales**
  se conservan, se dibujan y se editan por píxeles; la caja de recorte se expande
  una sola vez, en el servidor, que la devuelve para el overlay.
- MobileSAM se prepara desde el **proxy JPEG privado**, nunca desde el original:
  el servicio rechaza una imagen de más de 20 MP antes de reducirla. El
  propietario, la pertenencia imagen-vista-árbol y las cuatro vistas listas se
  comprueban **antes** de tocar cualquier modelo.
- El **ROI** lo delimita la persona revisora con el pincel; la vista completa es
  solo un atajo rotulado como exploratorio. Se pueden añadir **máscaras
  omitidas** aunque no haya ninguna propuesta.
- Reintentar las etiquetas de BioCLIP **no** vuelve a segmentar: no puede perder
  máscaras editadas, ROI ni decisiones. Regenerar es una acción distinta y
  explícita.
- Con el flag apagado no se renderiza el panel, no se llama a la ruta y no hay
  ninguna llamada a BioCLIP.
- Predicción y revisión confirmada se guardan por separado; una predicción nueva
  nunca sobrescribe una decisión humana.
- Solo las regiones **aceptadas como liquen** entran en la cobertura; pendientes,
  excluidas y sin determinar quedan fuera, y un ROI de área cero da "resultado no
  disponible".
- La máscara PNG del servicio es **escala de grises opaca** (fondo 0, región
  255): `decodeMaskToWorkingGrid` pasa `encoding: "grayscale"` de forma
  explícita. `maskFromRgba` mantiene `"alpha"` por defecto para las máscaras
  dibujadas en el cliente.
- Los recortes se ajustan a un **presupuesto de bytes** que contabiliza base64 y
  metadatos contra el límite del cuerpo del worker; si un lote no cabe, la
  respuesta es 413 explícito con preservación, nunca una clasificación parcial.
- Un recorte puede servir a varias regiones con la misma caja: se conserva cada
  `regionId` y la clasificación se reparte a todos.
