# Guided capture → jornada → results

The default `/analysis` panel reads the existing private guided reviews. The
jornada shows saved-view progress and links to `/analysis?eventId=…` with project
and site preserved. The saved tree screen links back to the same jornada results.
Each result opens the exact tree sample and its four-view/360 summary.

## Contract

- One tree sample is one evaluation in one jornada, not four trees.
- A tree revisited in a different jornada is a separate evaluation.
- Select the latest created capture series, matching the guided editor, and only
  its active capture views. Replaced photos and earlier series cannot supply a
  result. Duplicate active directions fail closed.
- Parse the persisted guided review. Only valid analysis plus explicit savedAt
  counts as saved. Draft, missing, invalid and a genuine zero are distinct.
- Coverage is per photograph: `100 * lichen / total`, using that photo's manually
  delimited trunk. Do not sum/average pixels across photographs, derive cm²,
  infer species, or classify air quality. BioCLIP checks examples, not the mask.
- Owner-scoped, authenticated reads with existing RLS, bounded pagination and
  batches. Read failures are shown as errors, never converted to zero results.
- Viewing results does not prepare/download photos, call models, run metrics
  RPCs, or write annotations. Existing saved reviews appear without reanalysis.
- Legacy annotation/calibrated results remain at `/analysis?mode=classic`;
  `captureSeriesId` deep links remain intact. The environmental module explicitly
  links to guided results and explains that its legacy counts are separate.
- No migrations, policy changes, new dependencies or environment variables.

## Tests

From apps/web with the project's dependencies installed:

```sh
npx tsc -p tsconfig.guided-results-tests.json
NODE_PATH="$PWD/node_modules:$PWD/test-stubs" node --test /tmp/lichendr-guided-results-tests/modules/four-view/guided-results.test.js /tmp/lichendr-guided-results-tests/modules/four-view/guided.component.test.js
```

These cover view states, owner/context boundaries, replacement, old series,
pagination/errors, scoped batched reads, URLs, a real React results render and
the existing guided save/restore/360 regressions. Live QA should open a previously
saved tree's jornada, compare all four percentages in Results with its summary,
reload, and verify the classic view remains accessible. Do not edit field data
or invoke inference merely to validate this read-only connection.
