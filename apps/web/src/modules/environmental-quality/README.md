Propósito
: Representar estimaciones y métricas de calidad ambiental basadas en análisis.

Datos que administra
- `EnvironmentalEstimate` y metadatos asociados

Responsabilidades
- Mostrar resultados, series temporales y trazabilidad

Pendiente
- Definición formal del índice y requisitos de muestreo

## Fase 1: base de datos y documentación de contexto ambiental

La migración aditiva `supabase/migrations/202608060001_create_environmental_quality_context.sql` no modifica migraciones históricas ni ejecuta migraciones remotas. Audita y reutiliza campos ya existentes en lugar de duplicarlos: `sites.latitude`, `sites.longitude`, `sites.radius_m`, `sites.notes`; `sampling_events.sampled_at`; `trees.species_name`, `trees.species_confidence`, `trees.latitude`, `trees.longitude`; y `tree_samples.sampling_height_m`, `tree_samples.trunk_orientation`, `tree_samples.notes`. Solo agrega almacenamiento normalizado para el contexto que faltaba y mediciones de contaminantes opcionales.

**Esta fase no crea ninguna tabla de estimación, índice o puntaje de calidad ambiental.**

### Esquema

- `public.site_environmental_contexts` (uno por jornada de muestreo, `sampling_event_id` como clave primaria y clave foránea compuesta con `site_id`): `land_use_classification` (texto libre opcional), `is_reference_candidate` (**booleano opcional**: `true`/`false`/`NULL`, donde `NULL` es estado de referencia desconocido), `measured_at`, `provenance`, `created_at`, `updated_at`. Estas observaciones dependientes del tiempo no sobrescriben otras campañas del mismo sitio.
- `public.tree_sample_scientific_contexts` (uno a uno con `tree_samples`, `tree_sample_id` como clave primaria y foránea con `on delete cascade`): `sampled_width_cm`, `sampled_height_cm`, `dbh_cm` (diámetro a la altura del pecho del árbol hospedero; contexto estructural, no duplica especie), `bark_ph`, `bark_texture` (texto libre opcional), `canopy_cover_percent`, `air_temperature_c`, `relative_humidity_percent`, `measured_at`, `provenance`, `created_at`, `updated_at`.
- `public.pollutant_measurements` (cero o varias por sitio; el evento de muestreo es opcional): `id`, `site_id`, `sampling_event_id` (nullable), `measured_at`, `pollutant_code`, `value`, `unit_code`, `averaging_period_minutes`, `instrument_method`, `data_source`, `qa_qc_status`, `notes`, `created_at`, `updated_at`. La clave foránea compuesta `pollutant_measurements_sampling_event_site_fk (sampling_event_id, site_id)` reutiliza la restricción única `sampling_events_id_site_id_unique`; con `sampling_event_id` nulo no se aplica verificación, y cuando se proporciona debe pertenecer al mismo sitio.

Detalle completo de campos, valores permitidos y restricciones exactas en `docs/DATA_DICTIONARY.md` y `docs/SUPABASE_DATABASE.md`.

### Rango de temperatura documentado

`tree_sample_scientific_contexts.air_temperature_c` exige, cuando se proporciona, `air_temperature_c >= -10 and air_temperature_c <= 50` (°C). **Es un rango operativo de validación de plausibilidad**, no un límite científico establecido por la literatura citada: su único propósito es rechazar errores evidentes de captura de datos. Ninguna referencia citada, incluido Counoy et al. (2025, DOI 10.1111/gcb.70632), especifica este rango numérico exacto. Los valores fuera de rango se **rechazan** (nunca se recortan ni se modifican). La temperatura se registra solo como variable climática descriptiva/confusora del momento y punto de la muestra; nunca se convierte ni se usa para calcular un índice. Ver rationale completo en `docs/SCIENTIFIC_METHOD.md`.

### RLS y seguridad

Las tres tablas habilitan Row Level Security con políticas `SELECT`, `INSERT`, `UPDATE` y `DELETE` limitadas a `to authenticated`, siguiendo `... → sites → projects.owner_id = auth.uid()` (o `... → tree_samples → sites → projects.owner_id = auth.uid()`). Cada política se recrea con `drop policy if exists ...;` inmediatamente antes de `create policy ...`. Cada tabla ejecuta `revoke all on table ... from anon;` — `anon` no tiene ningún privilegio. Ninguna función usa `SECURITY DEFINER`.

### Contaminantes: sin conversión ni combinaciones forzadas

`pollutant_code` tiene lista cerrada (`PM2.5`, `PM10`, `NO2`, `SO2`, `NH3`, `O3`, `CO`) y `unit_code` también (`ug_m3`, `mg_m3`, `ng_m3`, `ppm`, `ppb`). `averaging_period_minutes` distingue `NULL` (no reportado), `0` (instantáneo) y duraciones positivas en minutos. La agregación exige coincidencia de contaminante, unidad y período. **No existe ninguna restricción que combine `pollutant_code` con `unit_code`, y la base de datos no convierte unidades.** `value` **no tiene restricción de signo ni de rango**: preserva la lectura numérica cruda del instrumento (la deriva del sensor, la calibración o los artefactos pueden producir lecturas negativas). `qa_qc_status` (`not_assessed` por defecto, `provisional`, `validated`, `rejected`) es el mecanismo para evaluar la confiabilidad de cada lectura, sin alterar ni rechazar el valor medido.

### Limitación (aviso obligatorio)

> Los datos de contexto ambiental y las mediciones de contaminantes almacenados en esta fase son exclusivamente descriptivos y no constituyen un índice, puntaje o estimación de calidad ambiental. LichenDR no calcula ni infiere calidad del aire, contaminación alta o baja, ni conversiones entre unidades de contaminantes. Cualquier interpretación ambiental requiere validación científica adicional por especialistas.

### Referencias científicas

- EN 16413:2014. *Ambient air — Biomonitoring with lichens — Assessing epiphytic lichen diversity.*
- Counoy, H. et al. (2025). *Towards a New Interpretative Framework for Air Quality and Climate Biomonitoring With Lichens: A Meta-Analysis of Surveys Using the European Protocol.* Global Change Biology. DOI: [10.1111/gcb.70632](https://doi.org/10.1111/gcb.70632).
- Díaz, J. et al. (2021). *Epiphytic Cryptogams as Bioindicators of Air Quality in a Tropical Andean City.* Sustainability, 13(20), 11218. DOI: [10.3390/su132011218](https://doi.org/10.3390/su132011218).
- Sebald, J. et al. (2022). *NO2 air pollution drives species composition, but tree traits drive richness/diversity of epiphytic lichens in urban environments.* Environmental Pollution. DOI: [10.1016/j.envpol.2022.119678](https://doi.org/10.1016/j.envpol.2022.119678).
- Rautiainen, M., Kuusinen, N. & Majasalmi, T. (2024). *Remote sensing and spectroscopy of lichens.* Ecology and Evolution, 14(3), e11110. DOI: [10.1002/ece3.11110](https://doi.org/10.1002/ece3.11110).
- Cuenca et al. (2026). Atmospheric Pollution Research. DOI: [10.1016/j.apr.2026.103030](https://doi.org/10.1016/j.apr.2026.103030).
