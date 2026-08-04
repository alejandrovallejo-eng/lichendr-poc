insert into public.morphotypes (
  annotation_set_id,
  label,
  growth_form,
  color_hex,
  notes
)
select distinct on (canonical_set.id, lower(legacy_morphotype.label))
  canonical_set.id,
  legacy_morphotype.label,
  legacy_morphotype.growth_form,
  legacy_morphotype.color_hex,
  legacy_morphotype.notes
from public.morphotypes legacy_morphotype
join public.annotation_sets legacy_set
  on legacy_set.id = legacy_morphotype.annotation_set_id
join public.annotation_sets canonical_set
  on canonical_set.image_id = legacy_set.image_id
  and canonical_set.version = 1
where legacy_set.method = 'ai_assisted_segmentation'
  and legacy_set.id <> canonical_set.id
order by canonical_set.id, lower(legacy_morphotype.label), legacy_morphotype.created_at
on conflict (annotation_set_id, lower(label)) do nothing;

update public.annotation_regions region
set
  annotation_set_id = canonical_set.id,
  morphotype_id = canonical_morphotype.id
from public.annotation_sets legacy_set
join public.annotation_sets canonical_set
  on canonical_set.image_id = legacy_set.image_id
  and canonical_set.version = 1
join public.morphotypes legacy_morphotype
  on legacy_morphotype.annotation_set_id = legacy_set.id
join public.morphotypes canonical_morphotype
  on canonical_morphotype.annotation_set_id = canonical_set.id
  and lower(canonical_morphotype.label) = lower(legacy_morphotype.label)
where region.annotation_set_id = legacy_set.id
  and region.morphotype_id = legacy_morphotype.id
  and legacy_set.method = 'ai_assisted_segmentation'
  and legacy_set.id <> canonical_set.id;

update public.annotation_regions region
set annotation_set_id = canonical_set.id
from public.annotation_sets legacy_set
join public.annotation_sets canonical_set
  on canonical_set.image_id = legacy_set.image_id
  and canonical_set.version = 1
where region.annotation_set_id = legacy_set.id
  and region.morphotype_id is null
  and legacy_set.method = 'ai_assisted_segmentation'
  and legacy_set.id <> canonical_set.id;

delete from public.annotation_sets legacy_set
using public.annotation_sets canonical_set
where canonical_set.image_id = legacy_set.image_id
  and canonical_set.version = 1
  and legacy_set.method = 'ai_assisted_segmentation'
  and legacy_set.id <> canonical_set.id;
