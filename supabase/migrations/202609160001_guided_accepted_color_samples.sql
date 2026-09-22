-- Extend only the bounded review document, keeping v1 records readable.
-- No data deletion, ownership, RLS, credentials, grants or RPC changes.
begin;
alter table public.guided_capture_reviews drop constraint guided_review_bounded;
alter table public.guided_capture_reviews add constraint guided_review_bounded check (
  coalesce(jsonb_typeof(review) = 'object' and octet_length(review::text) <= 200000
    and review->>'version' = '1'
    and jsonb_typeof(review->'outline') = 'array'
    and jsonb_array_length(review->'outline') <= 64
    and jsonb_typeof(review->'config') = 'object'
    and jsonb_typeof(review->'config'->'samples') = 'array'
    and (
      (review->'config'->>'version' = '1' and jsonb_array_length(review->'config'->'samples') <= 6)
      or (review->'config'->>'version' = '2' and jsonb_array_length(review->'config'->'samples') <= 24
        and jsonb_typeof(review->'config'->'confirmed') = 'object'
        and jsonb_typeof(review->'config'->'confirmed'->'groups') = 'array'
        and jsonb_array_length(review->'config'->'confirmed'->'groups') between 1 and 8)
    ), false)
);
commit;
