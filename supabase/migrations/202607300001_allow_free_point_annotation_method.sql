alter table public.annotation_sets
drop constraint if exists annotation_sets_method_allowed;

alter table public.annotation_sets
add constraint annotation_sets_method_allowed
check (method in ('systematic_point_count', 'manual_free_points'));
