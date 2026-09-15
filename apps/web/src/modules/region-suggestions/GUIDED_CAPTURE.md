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

Originals are stored remotely. Guided polygon, colours and reviewed summary
remain in this browser, keyed by owner/tree sample/direction/image/version.
The screen states this limitation explicitly. They are separate from existing
SAM/BioCLIP human decisions and calibrated measurements; neither is overwritten.
Save/next only advances after local persistence succeeds. Edits invalidate the
saved review. Failed inference retains the image and samples, offers retry and
an explicitly labelled colour-only review (not silent AI success).

## Verification

`guided.component.test.tsx` is included in the existing component-test entry:
one active photo/editor, guarded step order, no bark sampling requirement,
one inference request, save failure stays on North, successful save opens East.
Pure colour check verifies unmatched pixels are not bark and remain in the
denominator. Route regressions now allow North alone and still reject inactive
images and other owners before any model call. Model mocks are not real inference.
