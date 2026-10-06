-- Application CAS conflicts are HTTP 409, not retryable transaction failures.
-- Preserve each deployed function's complete definition, ownership and grants;
-- change only the deliberate application-conflict SQLSTATE. No data writes.
begin;
do $migration$
declare
  signature text;
  definition text;
  revised text;
begin
  foreach signature in array array[
    'public.save_guided_capture_review(uuid,uuid,text,jsonb,integer)',
    'public.save_ecological_quadrat(uuid,uuid,uuid,text,jsonb,integer)',
    'public.rename_jornada_morphospecies(uuid,uuid,text,integer)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    revised := regexp_replace(definition, 'errcode\s*=\s*''40001''', 'errcode = ''PT409''', 'g');
    if revised = definition and position('PT409' in definition) = 0 then
      raise exception 'Expected conflict guard absent from %', signature;
    end if;
    if revised <> definition then execute revised; end if;
  end loop;
end;
$migration$;
commit;
