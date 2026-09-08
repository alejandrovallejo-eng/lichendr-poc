# `region-suggestions`

Lógica y UI del piloto revisable BioCLIP + MobileSAM. Documentación completa,
evidencia y limitaciones: [`docs/BIOCLIP_PILOT.md`](../../../../docs/BIOCLIP_PILOT.md).

| archivo | responsabilidad |
| --- | --- |
| `types.ts` | Etiquetas, decisiones, cadena de transformaciones, procedencia. |
| `flag.ts` | Flag `NEXT_PUBLIC_BIOCLIP_SUGGESTIONS`, apagado por defecto. |
| `crop-geometry.ts` | Recorte con contexto, deduplicado, escalado y EXIF (espejo de `services/bioclip/crops.py`). |
| `review.ts` | Clave de caché/idempotencia, fusión que nunca sobrescribe decisiones humanas, guardas de contexto, fases. |
| `coverage.ts` | Cobertura revisada por unión ∩ ROI, exploratoria y excluida de agregados científicos. |
| `client.ts` | Rejilla fija de prompts, conversión de máscaras a regiones y llamada a la ruta. |
| `storage.ts` | Restauración tras recarga acotada al propietario, sin migración ni cambios de RLS. |
| `RegionSuggestionsPanel.tsx` | Panel en español: Buscando regiones → Sugiriendo etiquetas → Revisar. |

Invariantes:

- Con el flag apagado no se renderiza el panel, no se llama a la ruta y no hay
  ninguna llamada a BioCLIP.
- Predicción y revisión confirmada se guardan por separado; una predicción nueva
  nunca sobrescribe una decisión humana.
- Solo las regiones **aceptadas como liquen** entran en la cobertura; pendientes,
  excluidas y sin determinar quedan fuera, y un ROI de área cero da "resultado no
  disponible".
