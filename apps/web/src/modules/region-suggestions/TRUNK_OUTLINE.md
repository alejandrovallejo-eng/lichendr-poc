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
- Eyedropper sampling, per-photo perceptual colour grouping and automatic colour
  coverage are a subsequent phase, not implemented by this change.

## Checks

`npm run test:component` includes `trunk-outline.test.ts` (four geometry/storage
tests) plus five panel/editor tests. The geometry tests verify central and
concave sampling, clipping without mutating the source, invalid polygons and
per-photo storage isolation. Component tests cover edit/undo/cancel/confirm,
restoration before any model request, and preservation of human decisions.

These automated tests use synthetic images/stubs, not real MobileSAM or BioCLIP
inference. The separately documented Preview run is the real-image check.
