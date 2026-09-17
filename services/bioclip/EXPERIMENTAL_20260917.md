# Optional BioCLIP comparison — not a default replacement

The five-class candidate is opt-in, under **Colores → Opciones de IA → Comparar
detector ampliado (experimental)**. It runs alongside the existing three-class
head. Responses and cached suggestions from the default path are unchanged.
Saved human masks, named morphospecies, coverage and ecological aggregates are
never recomputed by a candidate decision.

Classes: lichen, moss, bark, algae, non-lichenized fungus. Training-only
abstention returns **Sin determinar**, which is not a negative observation.
The named label is not a species and a crop label does not classify every pixel.

## Evidence and limits

Frozen BioCLIP 2 encoder; ridge head fitted on 158 training regions. Entire
observers separated from tests. 75 newly selected regions were curated before
inference: 37 train, 38 fresh holdout. All 78 previous holdouts remained
regression controls and were never trained on. Only CC0/CC BY source photos.
Community Research Grade plus visual curation is a provisional reference, not
expert segmentation truth. Encoder pretraining overlap is unknown. No claim of
species accuracy, field coverage accuracy or air quality follows from this study.

Fresh 38: habitual model called 12/28 non-lichens lichen and found 10/10 lichens.
Candidate: 0/28 false-lichen, 7/10 lichens detected, 5 abstentions overall,
33/38 correct decisions. Historical 78: candidate 70 correct, 8 abstentions,
zero false-lichen, 20/22 lichens detected. The lichen-recall promotion gates
FAILED. Thresholds were not relaxed. This model must NOT silently replace the
habitual model. Selective correctness is not 100% general accuracy.

## Reproducibility

Model ID: `inat-five-class-20260917`.
Bundle SHA-256: `564fb614774d3c34731186e0bf8384700758c67c692879a6ad39959ea252863c`.
The bundle covers the head, reference embeddings and rejection policy;
individual hashes are pinned in `experimental.py`. No arbitrary pickle load.

`lichendr-bioclip-experimental-20260917.tar.gz` is the full Cloud Run build
context, including original pinned head, optional candidate artefacts, runtime
wrapper and tests. It contains NO secrets, photographs or encoder weights.
Archive SHA-256: `490291b148e34d6bdfd2a01a9a4188933bf5cf68cd199d33217934412660e0bc`.
The worker Python sources alongside this document match the package.

Study source, scripts, manifests and HTML report are preserved in the local
workspace `experiments/inat-complete-20260917`. Source attribution is provided
in `INAT_MODEL_SOURCES_20260917.json`; split labels distinguish training from
held-out data. All held-out images must remain out of future fitting unless
explicitly retired and replaced by a new untouched test set.

Packaged worker replayed all 75 actual new images with exact embeddings
(max absolute delta 0) and matching candidate decisions. Actual HTTP comparison
left default predictions unchanged. 41 Python, 24 route/contract and 40 guided
interface/result tests passed locally. New experimental TypeScript tests require
the same tsc/CommonJS test recipe with `--jsx react-jsx` because they also render
the disclosure component.

The original hand-rounded worker preprocessing differs slightly from the study's
stock CLIP transform. Preserve the old path. Experimental inference uses the
exact study transform, sequentially, with the same loaded model; it incurs extra
compute only when selected, not another model allocation.

## Release safety

The service named `lichendr-bioclip-preview` currently also serves Production.
Deploy a tagged revision with no traffic first; keep the previous revision for
rollback. Do not run the historical bootstrap script to update an existing
service. Do not change IAM, runtime identity, secrets, plan or instance limits.
UI and model are published independently; an older/missing worker fails with an
explicit experimental-unavailable message instead of mislabelling default output.
No RLS or database migration is required.
