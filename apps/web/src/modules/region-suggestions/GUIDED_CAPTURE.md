# Sequential capture (Preview)

`/images` now uses one full-viewport editor, one direction and one step:
photo → trunk polygon → lichen-only colour samples → analysis → save/next.
Project, site, journey and tree remain attached to every original. The old
scientific calibration/review screen remains accessible with `mode=advanced`;
its all-four automatic runner is not executed behind the guided screen.

## Analysis and limits

- The original is uploaded to private Storage and registered with the existing
  capture-view RPC. The existing oriented 2048px proxy is used for display;
  colour computation is bounded to a proportional 1024px grid.
- A confirmed polygon excludes the background from the coverage denominator.
- Only user-labelled lichen colours are required. Non-matching pixels remain
  unclassified, not inferred bare bark. Colour groups are not species.
- Coverage is DeltaE colour similarity, NOT an AI segmentation measurement.
  BioCLIP additionally checks up to six representative patches at the selected
  samples; its label ranking is advisory, not pixel validation or a probability.
  MobileSAM is not invoked in this guided colour workflow.
- Server authorization now verifies the requested active view and its private
  original/proxy without requiring the other directions to exist. Session,
  image ownership, tree/view association, safe storage, flags and model limits
  remain in place. This never marks a scientific series complete.

## Saving

Originals remain in private Storage. Guided polygon, lichen colours and reviewed
summary are stored in `guided_capture_reviews`, scoped to the authenticated
owner, active image, tree sample and direction. The isolated migration is
`202609150001_create_guided_capture_reviews.sql`; it does not replace existing
capture, calibration or human SAM/BioCLIP decisions. RLS and the security-invoker
save RPC validate ownership and the active view. Revision checks prevent stale
writes; identical retries are idempotent. Apply the migration before this UI.

Local storage is only a recovery aid: quota errors do not prevent cloud saves.
Cloud data restores the editor after browser storage is cleared. Differing local
drafts remain recoverable rather than silently overwriting the server. Edits
invalidate the saved result. Save/next waits for a cloud acknowledgement and
stays on the current direction if that fails. Restored colour masks are computed
locally; restoring a saved review does not call AI.

Failed inference retains the photograph and colour samples and offers retry or
an explicitly labelled colour-only review, never silent AI success. Cloud Run
health is awaited for up to 150 seconds before sending crops (observed startup
was about 100 seconds); failure does not send an inference request. Inference
has its existing 120-second limit, within the route's 300-second budget. The UI
allows 285 seconds and shows preparation progress; cancellation remains usable.

## Verification

`guided.component.test.tsx` is included in the existing component-test entry:
one active photo/editor, guarded step order, no bark sampling requirement,
one inference request, save failure stays on North, successful save opens East.
Pure colour check verifies unmatched pixels are not bark and remain in the
denominator. Route regressions now allow North alone and still reject inactive
images and other owners before any model call. Additional tests cover cloud
revision ordering, JSONB key-order-independent retry, quota failure, cloud restore,
and the Cloud Run startup barrier. Real PostgreSQL checks cover RLS, stale writes,
idempotent retries and invalid payloads. Model mocks are not real inference.
