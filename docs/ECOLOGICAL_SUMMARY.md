# Resumen ecológico de jornada

Entry: Análisis de diversidad → Resumen de jornada, or **Ver resumen ecológico**
from the administrative closure screen. **Cuadrantes y catálogo** retains the
existing editor, optional names, accepted local tones and shared catalogue.
Opening from a specific tree still prioritizes its quadrat workflow.

This is a read-only descriptive summary over existing owner-scoped reads. No new
tables, migrations, secrets, model calls or dependencies. Loading or switching
sections never saves/reclassifies anything. Explicit editing uses existing flows.

## Rules

- One jornada/site only; no cross-event pooling. Mixed context or duplicate tree
  identities fail closed. Four directions are views, not independent trees.
- Count only current active images with saved trunk source, matching image,
  sample, event, direction, outline and dimensions. Replaced/stale/ambiguous views
  are excluded and stay visible as pending or needing review.
- Presence is recorded at positive marked pixels and keyed by catalogue UUID,
  not name, RGB or local mask label. One tree counts once per morphospecies.
- The denominator beside each presence count is trees with at least one current
  reviewed quadrat. Partial effort and four-of-four counts remain explicit.
  Unrecorded is not inferred absence. Catalogue-only entries are not observations.
- Coverage always divides marked pixels by that quadrat's own pixel total.
  There is no pooled/mean whole-tree or area coverage. Full-trunk coverage is
  separate. Unknown pixels are not assumed bark; reviewed zero differs from
  unreviewed. These are groups, not individual lichen counts.
- Uncalibrated exploratory quadrats and user names do not establish taxonomic
  validation, standardized sampling, population representativeness or air quality.
  Closing capture is administrative, not ecological completion/certification.
- Reload explicitly with **Actualizar resultados** for edits from another tab.
  Read failure replaces results with retry, never fabricates zeros.

## Tests

From apps/web, compile with `tsc -p tsconfig.ecology-summary-tests.json`.
On the first run create the compiled alias with
`ln -s . /tmp/lichendr-ecology-summary-tests/@` (keep it on subsequent runs), then
`NODE_PATH="$PWD/node_modules:$PWD/test-stubs:/tmp/lichendr-ecology-summary-tests" node --test /tmp/lichendr-ecology-summary-tests/modules/four-view/ecology-summary.test.js`.
Includes tree deduplication, local label remapping, per-quadrat denominators,
zero vs pending, stale/replaced sources, identity boundaries, mixed context,
renaming, empty states, contextual links, UI navigation and failed-read recovery.
No model inference is claimed by these tests.
