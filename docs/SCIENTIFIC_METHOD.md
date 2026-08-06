Método científico y consideraciones

- Los morfotipos visuales NO equivalen automáticamente a especies.
- Cobertura y diversidad se analizan como métricas separadas.
- Las estimaciones ambientales requieren un mínimo de muestreo antes de ser informativas.
- Los algoritmos y modelos deben versionarse y sus resultados conservar trazabilidad.
- La imagen original NUNCA debe ser modificada; las derivadas deben almacenarse por separado.
- Las máscaras aceptadas de MobileSAM se conservan como capas de anotación separadas, con modelo, versión, prompts y score para mantener trazabilidad.
- La versión 1 utilizará una cuadrícula sistemática.
- El usuario clasificará todos los puntos.
- Los puntos evaluables serán `lichen`, `bark`, `moss` y `algae`.
- `shadow`, `glare` y `unknown` se excluirán del denominador.
- `lichen cover percentage = lichen points / evaluable points × 100`.
- Un morfotipo visible no equivale necesariamente a una especie.

## Cobertura descriptiva mediante máscaras

Para cada evaluación completada, la versión `1.0.0` del método `mask_union_intersection`:

1. crea la máscara binaria del tronco confirmado;
2. crea la unión binaria de todas las regiones aceptadas clasificadas como `lichen`;
3. intersecta esa unión con el tronco;
4. cuenta por separado los píxeles de liquen fuera del tronco y los píxeles solapados;
5. calcula `coverage_percent = lichen_union_inside_trunk_pixels / trunk_pixels × 100`.

La unión evita contar dos veces regiones solapadas. Las máscaras deben compartir dimensiones. Si el tronco falta, tiene área cero o existen dimensiones incompatibles, la cobertura queda nula y se presenta “Datos insuficientes”.

Se marca `high_lichen_overlap` cuando los píxeles solapados representan al menos el 20 % de la suma de áreas de las máscaras de liquen. Este umbral es una alerta de revisión de datos, no una interpretación ambiental.

La cobertura ponderada para varias imágenes es:

`sum(lichen_union_inside_trunk_pixels) / sum(trunk_pixels) × 100`

La mediana, mínimo y máximo por imagen se muestran como estadísticas complementarias; no sustituyen la cobertura ponderada.

## Inclusión, trazabilidad y limitaciones

Análisis usa exclusivamente `annotation_sets.status = 'completed'` con `completed_at is not null`. Los borradores se excluyen aunque conserven una métrica anterior. Las máscaras se descargan solo para calcular o revisar una evaluación; las agregaciones usan métricas persistidas con método, versión, fecha y alertas.

“Cobertura observada de líquenes” es un resultado descriptivo y una estimación provisional. No equivale a buena o mala calidad ambiental, contaminación alta o baja, ni aire limpio o contaminado. Se requiere calibración científica adicional antes de derivar cualquiera de esas categorías.

Los resultados son descriptivos y provisionales. No constituyen por sí solos una clasificación de calidad ambiental.

## Fase 1 de Calidad Ambiental: contexto de sitio, contexto de muestra y contaminantes

La migración `202608060001_create_environmental_quality_context.sql` audita y reutiliza los campos ya existentes en lugar de duplicarlos: `sites.latitude`, `sites.longitude`, `sites.radius_m`, `sites.notes`; `sampling_events.sampled_at`; `trees.species_name`, `trees.species_confidence`, `trees.latitude`, `trees.longitude`; y `tree_samples.sampling_height_m`, `tree_samples.trunk_orientation`, `tree_samples.notes`. Solo agrega almacenamiento normalizado para el contexto que faltaba (`public.site_environmental_contexts`, `public.tree_sample_scientific_contexts`) y mediciones de contaminantes opcionales (`public.pollutant_measurements`).

**Esta fase no crea, calcula ni infiere ningún índice, puntaje o estimación de calidad ambiental.** No existe una tabla de estimación ambiental. Los tres formatos nuevos son únicamente contenedores descriptivos de observaciones de campo o laboratorio.

### Por qué el rango documentado de temperatura ambiente

`tree_sample_scientific_contexts.air_temperature_c` exige, cuando se proporciona, `air_temperature_c >= -10 and air_temperature_c <= 50` (grados Celsius). Este campo se registra a nivel de muestra de árbol (no a nivel de sitio), porque la temperatura del aire en el momento y punto exacto de la jornada de muestreo es la variable climática relevante para interpretar la observación biológica puntual.

**Este rango es un límite operativo de validación de plausibilidad, no un rango científico establecido por la literatura citada.** Su único propósito es rechazar errores evidentes de captura de datos (por ejemplo, un dígito mal escrito o una confusión de escala de temperatura), no delimitar condiciones climáticas "válidas" para el biomonitoreo con líquenes. **Ninguna de las referencias citadas en esta fase — incluido Counoy et al. (2025, DOI 10.1111/gcb.70632) — establece ni especifica estos límites numéricos exactos**; ese meta-análisis del protocolo europeo de biomonitoreo con líquenes epífitos únicamente señala, en términos generales, que la temperatura y la humedad son variables climáticas que modulan la respuesta de los líquenes indicadores y deben registrarse junto con la observación biológica — no propone un rango de -10 °C a 50 °C ni ningún otro límite numérico específico.

Cuando un valor de `air_temperature_c` está fuera de este rango, la inserción o actualización **se rechaza por completo**; el valor nunca se recorta (clamp), ajusta o modifica silenciosamente para encajar dentro del rango. La temperatura se registra exclusivamente como variable climática descriptiva/confusora para ayudar a interpretar el contexto de una muestra. **No se convierte a otra escala ni se usa para calcular un índice o estimación de calidad ambiental.**

### Contexto de sitio (`site_environmental_contexts`)

Campos descriptivos por sitio y jornada de muestreo: `land_use_classification` (texto libre, sin lista cerrada, para describir el uso de suelo observado durante la campaña) e `is_reference_candidate` (**booleano opcional**: `true` marca un candidato a sitio de referencia/control, `false` lo descarta explícitamente, y `NULL` indica que el estado de referencia aún no se ha evaluado — el estado desconocido se preserva como ausencia de valor, no como una cadena de texto). `sampling_event_id` es la clave primaria y la clave foránea compuesta con `site_id` impide asociar una jornada de otro sitio; así, campañas distintas no se sobrescriben. Este último campo documenta el entorno del sitio de forma consistente con la necesidad, señalada por Díaz et al. (2021, DOI 10.3390/su132011218), de distinguir zonas urbanas, periurbanas y de control al interpretar bioindicadores epífitos en ciudades tropicales andinas, y con la evidencia de Sebald et al. (2022, DOI 10.1016/j.envpol.2022.119678) de que la contaminación por NO₂ y los rasgos del árbol influyen en la composición de líquenes urbanos.

### Contexto científico de la muestra de árbol (`tree_sample_scientific_contexts`)

Campos descriptivos por muestra: `sampled_width_cm`/`sampled_height_cm` (dimensiones del área de muestra evaluada), `dbh_cm` (diámetro a la altura del pecho, DAP, del **árbol hospedero** — contexto estructural del árbol donde se tomó la muestra, medido en el momento del muestreo; **no duplica la identidad de especie**, que ya se registra en `trees.species_name`/`trees.species_confidence`), `bark_ph` (pH de corteza, un factor citado por Sebald et al. 2022 como más determinante de la diversidad de líquenes que la contaminación por sí sola), `bark_texture` (textura de corteza, texto libre), `canopy_cover_percent` (cobertura de dosel), `air_temperature_c` y `relative_humidity_percent` (clima puntual en el momento de la muestra). Ninguno de estos campos sustituye ni duplica `sampling_height_m`, `trunk_orientation` o `notes`, que ya existen en `tree_samples`, ni la especie del árbol, que ya existe en `trees`.

### Mediciones de contaminantes (`pollutant_measurements`)

Cada fila registra una medición descriptiva: `pollutant_code` (lista cerrada: `PM2.5`, `PM10`, `NO2`, `SO2`, `NH3`, `O3`, `CO`), `value`, `unit` (texto libre), `averaging_period` (período de promediación, p. ej. `1 h`, `24 h`), `instrument_method`, `data_source`, `qa_qc_status` (`not_assessed` por defecto, `provisional`, `validated` o `rejected`), `measured_at` y `notes`. **No existe ninguna restricción que combine `pollutant_code` con `unit`, y la base de datos no convierte unidades entre sí.** `value` **no tiene restricción de signo ni de rango**: se preserva la lectura numérica cruda del instrumento tal como se reporta, ya que la deriva del sensor, los desplazamientos de calibración o los artefactos del instrumento pueden producir lecturas negativas; la confiabilidad de cada lectura se evalúa mediante `qa_qc_status`, no rechazando el valor en la base de datos. El campo `sampling_event_id` es opcional: cuando se omite no se aplica ninguna verificación, y cuando se proporciona debe corresponder al mismo `site_id` de la medición (clave foránea compuesta `pollutant_measurements_sampling_event_site_fk`), permitiendo registrar mediciones independientes de una jornada de muestreo específica sin dejar de garantizar la consistencia del sitio cuando sí se vincula a una.

La relevancia de registrar mediciones de contaminantes junto con la observación de líquenes está respaldada por Rautiainen et al. (2024, DOI 10.1002/ece3.11110), quienes documentan el uso de líquenes como indicadores ecológicos de contaminación en estudios de teledetección, y por trabajos regionales recientes como Cuenca et al. (2026, DOI 10.1016/j.apr.2026.103030) sobre contaminación atmosférica.

### Aviso obligatorio

> Los datos de contexto ambiental y las mediciones de contaminantes almacenados en esta fase son exclusivamente descriptivos y no constituyen un índice, puntaje o estimación de calidad ambiental. LichenDR no calcula ni infiere calidad del aire, contaminación alta o baja, ni conversiones entre unidades de contaminantes. Cualquier interpretación ambiental requiere validación científica adicional por especialistas.

### Referencias citadas en esta fase

- EN 16413:2014. *Ambient air — Biomonitoring with lichens — Assessing epiphytic lichen diversity.*
- Counoy, H. et al. (2025). *Towards a New Interpretative Framework for Air Quality and Climate Biomonitoring With Lichens: A Meta-Analysis of Surveys Using the European Protocol.* Global Change Biology. DOI: [10.1111/gcb.70632](https://doi.org/10.1111/gcb.70632).
- Díaz, J. et al. (2021). *Epiphytic Cryptogams as Bioindicators of Air Quality in a Tropical Andean City.* Sustainability, 13(20), 11218. DOI: [10.3390/su132011218](https://doi.org/10.3390/su132011218).
- Sebald, J. et al. (2022). *NO2 air pollution drives species composition, but tree traits drive richness/diversity of epiphytic lichens in urban environments.* Environmental Pollution. DOI: [10.1016/j.envpol.2022.119678](https://doi.org/10.1016/j.envpol.2022.119678).
- Rautiainen, M., Kuusinen, N. & Majasalmi, T. (2024). *Remote sensing and spectroscopy of lichens.* Ecology and Evolution, 14(3), e11110. DOI: [10.1002/ece3.11110](https://doi.org/10.1002/ece3.11110).
- Cuenca et al. (2026). Atmospheric Pollution Research. DOI: [10.1016/j.apr.2026.103030](https://doi.org/10.1016/j.apr.2026.103030).
