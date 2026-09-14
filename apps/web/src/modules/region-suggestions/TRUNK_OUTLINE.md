# Manual trunk outline — Preview phase 1

The reviewer defines a polygon per owner/tree/view/image before requesting new
MobileSAM proposals. Existing photographs, masks and human decisions are not
automatically regenerated or relabelled.

## Interaction

- Click around the trunk; the last vertex joins the first. Up to 64 vertices.
- Drag vertices, or focus a vertex and use arrow keys (Shift increases movement).
- Undo, delete the selected vertex, restart the draft, cancel or confirm.
- Crossing edges, duplicate adjacent points and degenerate contours are rejected.
- Cancel preserves the previously confirmed contour. Confirm invalidates the
  completeness checkbox but preserves existing review decisions and masks.
- Confirmed vertices use normalized image coordinates. They survive reloads in
  the same browser/origin/account; they are not yet synchronized to other devices.
  A storage failure produces an explicit warning. Drafts are not persisted.

## Model boundary

The existing four-photo server gate, private storage, authentication and model
deployments remain unchanged. Once the SAM session returns its dimensions, the
polygon is rasterized to that working grid. Five occupied rows with three
occupied positions each yield at most 15 normalized positive prompts, including
the trunk centre. Every prompt is inside the polygon, including concave contours.

Each returned candidate mask is intersected with the trunk before it becomes a
proposed region. Empty masks are discarded. Region IDs include the trunk-mask
hash, avoiding inheritance of old `sam-0` decisions. Previous orphaned decisions
remain saved but do not count in the current proposal summary. SAM's displayed
score describes its original candidate, not the clipped mask.

Confirming a contour does not clip old reviewed proposals. The reviewer must
explicitly request regeneration, with the existing replacement confirmation.
Manual mask edits remain possible; coverage is intersected with the trunk ROI.

## Scientific and feature limits

- This selects the visible analysis area, not physical surface area or a
  calibrated quadrat. It does not replace measurement calibration.
- Existing coverage uses the union of reviewed lichen pixels intersected with
  the ROI, divided by ROI pixels. It is not a species count or air-quality claim.
- BioCLIP still classifies contextual rectangular crops; those crops can include
  surroundings. A proposed label is not proof of what each selected pixel is.
- Polygon clipping does not establish lichen-detection accuracy. SAM can still
  return large or unhelpful regions within the trunk.
- Eyedropper sampling and exploratory colour coverage are described below. They
  remain independent of the existing model review and calibrated analysis.

## Phase 2 — local eyedropper and colour coverage

After confirming a trunk, open the colour tool. Choose bark or one of three
user-labelled lichen tone groups and click several examples. The original
oriented browser preview supplies pixels, not a screenshot of its coloured
overlay. Each sample averages an in-ROI opaque 3x3 neighbourhood. At most 24
samples are stored per photo. Keyboard arrows and Enter can also sample.

The working image keeps aspect ratio, never upscales, and is capped at 1024 px
per side. Samples and pixels are compared in sRGB/D65 CIELAB (DeltaE76, same
conversion as the existing annotation colour worker). Default tolerance is 12,
adjustable 3–35. This is a heuristic, not a validated biological threshold.
The nearest sample in each class competes; pixels exceeding tolerance or with
the first two classes within 2 DeltaE units remain unknown. Labels are disjoint;
no background pixel is included. Transparent pixels inside the ROI are unknown.
Computation yields every 8192 pixels and cancels when settings change or the
tool closes. No server/model request or new dependency is required.

Coverage = union of the three lichen-tone classes / ALL trunk ROI pixels.
Unknown remains in the denominator, and bark/unknown/each tone are shown
separately. A high unknown fraction can substantially understate lichen cover.
This is visible projected pixel coverage on a downscaled photo, not true curved
surface area, species identification, calibrated coverage or air-quality output.
Illumination, shadows and colour overlap can still cause false positives and
negatives. Human review is essential; confirm only after visual inspection.

Configuration is stored separately by owner/tree/view/image/full polygon/version
in this browser. Result masks are recalculated, not saved as large binary data.
Review restoration requires exact configuration, working dimensions, per-class
counts and result-label hash; changing samples or tolerance invalidates review.
A different polygon starts a separate selection. Storage failures are reported.
Deleting samples requires confirmation; individual samples can be removed.
SAM masks, manual decisions, original photos, physical calibration and existing
coverage are neither overwritten nor summed with the colour estimate.

## Checks

`npm run test:component` includes `trunk-outline.test.ts` (four geometry/storage
tests) plus five panel/editor tests, six colour algorithm regressions and one
colour UI regression. Colour checks cover ROI bounds, uncertain ties, disjoint
coverage, persistence and review restoration, cancellation, invalid configuration,
sampling from pristine image pixels, contour isolation and no model calls.
The geometry tests verify central and
concave sampling, clipping without mutating the source, invalid polygons and
per-photo storage isolation. Component tests cover edit/undo/cancel/confirm,
restoration before any model request, and preservation of human decisions.

These automated tests use synthetic images/stubs, not real MobileSAM or BioCLIP
inference. The separately documented Preview run is the real-image check.
