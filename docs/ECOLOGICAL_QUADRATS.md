# Exploratory quadrats and jornada morphospecies

The existing guided capture, full-trunk colour results and 360 remain unchanged.
From a jornada or its tree results, open **Análisis de diversidad**. Each saved
current view can have one independently reviewed rectangular quadrat. The user
selects opposite corners within the existing trunk. The canvas zooms to the
quadrat; matching and the denominator are restricted to its pixels.

## Catalogue and colour review

- A jornada owns a catalogue of stable UUID identities, named Morfoespecie A,
  B… AA. No confidence or certainty input. No taxonomic identification claim.
- The catalogue can be toggled while sampling. Selecting an existing identity
  on another view does not copy colours, coordinates, masks or percentages.
- Reference swatches come from saved reviews. New local tones are sampled from
  the current photograph and explicitly accepted/discarded. Multiple accepted
  tones extend the same morphospecies; earlier accepted pixels cannot be stolen
  or double counted. The existing bounded colour engine is reused, without an
  extra MobileSAM/BioCLIP request or a new image upload.
- A local class number is not a global identity. A may be class 3 in North and
  class 4 in East; aggregation uses its catalogue UUID, not label or RGB.
- Limits: 64 catalogue entries per jornada, 8 groups and 24 accepted tones per
  quadrat; the existing <=1024px analysis grid is used. Unknown stays unknown,
  never automatic bark. Explicitly reviewed/no marked group differs from pending.

## Persistence and safety

Apply additive migration `202609160002_ecological_quadrats.sql`. New tables
`jornada_morphospecies` and `ecological_quadrat_reviews` use owner-scoped RLS for
reads. Browser roles have no direct writes. Bounded, search-path-pinned RPCs
check project ownership, jornada/site/sample/image/direction, latest active
capture and the saved trunk outline/dimensions. Catalogue creation is serialized
per jornada and accepts an idempotency UUID. Review saves use optimistic revisions
and idempotent retry; stale tabs cannot overwrite current documents silently.

The editor saves only on explicit Save. Navigation warns about unsaved work;
proposals never count as saved. A failed save leaves the mounted editor intact.
The result parser rejects corrupt shapes/counts and out-of-trunk quadrats. A
changed trunk invalidates the ecological result until reviewed; it is not reused
as current. No original/trunk review, calibrated annotation, old policy, secret
or model is rewritten. The original photo and saved trunk remain prerequisites.

## Interpretation

All quadrats currently have `scale: uncalibrated`. Values describe relative image
coverage in the selected area, not physical cm², an entire tree, individual
counts, verified species richness or air quality. Journey/tree summaries count
unique *observed morphospecies IDs* in current saved quadrats. An unused catalogue
entry is not an observation. Percentages/pixel counts are never added or averaged
across views. Standardized physical quadrats and a validated ecological/air-quality
protocol remain separate future work.

## Validation

`tsconfig.ecology-tests.json` compiles the isolated tests plus the new UI/service.
Run generated `ecology.test.js` with Node's test runner and the existing test
dependencies. `scripts/test-ecology-db.mjs` runs the migration in isolated PGlite
PostgreSQL and never connects to Supabase. Pass the migration path as its argument.
Keep the existing guided/results/360/accepted-colour regression suite green.
