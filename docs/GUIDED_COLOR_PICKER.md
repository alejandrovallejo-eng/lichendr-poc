# Guided colour acceptance (Preview)

Reuses the current five-step GuidedCapture screen and the existing bounded
CIELAB colour engine; the old Annotation Studio's candidate/acceptance model
is brought into the guided flow, not its complex screen.

Choose a group, click a tone, inspect the magenta proposal, accept or discard.
The captured RGB swatch and a target on the photograph appear before matching
finishes. Magenta plus a dark edge is only a high-contrast proposal overlay,
not a sampled colour, model inference or group label. A photo-without-marks
comparison never discards the pending selection. Accepted swatches are numbered;
"another tone" keeps the active group, while "another lichen" creates a group.
Accept stays in the same group; further tones extend it. Exclude a connected
island by clicking it. Undo removes the last accepted addition only. Up to eight
photo-local groups and 24 tones. Names do not certify taxonomic identity.
Stable group overlay colours are separate from the actual sampled RGB tones.

Colour config v2 records group IDs/names and an ordered list of accepted tones,
each with its own DeltaE76 tolerance and excluded component seeds. Proposals
are ephemeral and never saved. First accepted group owns a pixel; later matches
to another group are reported and left unchanged. Unknown stays in the trunk
denominator. Union is disjoint, with no duplicate coverage or automatic bark.
This is deterministic colour segmentation, not model inference.

Unmodified v1 reviews keep their original algorithm, counts and saved status.
On an explicit edit, the v1 sample prefix and tolerance remain immutable;
new accepted additions affect only unclassified pixels. The 1024px raster,
photo identity, outline, cloud owner scope, CAS revisions, and existing saved
count verification remain. Old clients reject v2 rather than silently voting
on the ordered samples. Reconstruction depends on the same analysis image.

The existing cloud table stores the complete document. Apply
202609160001_guided_accepted_color_samples.sql before using more than six tones.
It extends only document bounds, retaining old reviews, RLS and revision RPC.
No original images, saved scientific annotation sets or production deployment
are replaced. Groups are local to each photo: a cross-photo taxon catalogue,
standardized quadrats, species verification and ecological diversity indices
remain a separate next phase; this does not claim an air-quality measurement.

BioCLIP remains advisory and sees at most six example crops per analysis, not
every selected tone or accepted pixel. No request per dropper click. Summary,
four-view results and approximate 360 reconstruct the same accepted selection.

Validation: targeted TypeScript compilation, old guided/results/orbit tests,
v1 colour tests, new acceptance/undo/exclusion/conflict/serialization and React
picker regressions. Isolated PostgreSQL checks include extended limits and the
existing ownership, revision, inactive-image and anonymous-user protections.
Test fixtures do not establish biological accuracy of the selected regions.
