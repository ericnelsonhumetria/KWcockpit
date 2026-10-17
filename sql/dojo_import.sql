-- =====================================================================
-- COCKPIT KW — Import unique de l'historique de l'ancien Dojo (formulaires Netlify « kw-rapport ») dans dojo_resultats
-- À exécuter APRÈS dojo_acces.sql. Idempotent (relançable). Ne supprime AUCUNE donnée.
--   · deux colonnes de traçabilité : source ('netlify') et source_id (identifiant de la soumission) ;
--   · un index unique sur (source, source_id) : un même rapport ne peut pas être importé deux fois ;
--   · dojo_importer(lignes) : réservé à la direction (CEO / administrateurs), appelé par le bouton « Importer l'ancien Dojo »
--     de la page Résultats. Les simulations gardent leur date d'origine.
-- =====================================================================

alter table public.dojo_resultats add column if not exists source text;
alter table public.dojo_resultats add column if not exists source_id text;
create unique index if not exists dojo_resultats_source_uidx on public.dojo_resultats (source, source_id) where source_id is not null;

create or replace function public.dojo_importer(p_lignes jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n_recu int := coalesce(jsonb_array_length(p_lignes), 0); n_ins int := 0;
begin
  if public.dojo_role() is distinct from 'eric' then
    raise exception 'Import réservé à la direction.' using errcode = '42501';
  end if;
  insert into public.dojo_resultats (source, source_id, created_at, email, consultant, scenario, tag, industrie, date_texte, score, evaluation, transcript)
  select 'netlify', x.source_id, coalesce(x.created_at, now()), nullif(lower(btrim(x.email)), ''), x.consultant, x.scenario, x.tag, x.industrie,
         x.date_texte, x.score, x.evaluation, x.transcript
    from jsonb_to_recordset(p_lignes) as x(source_id text, created_at timestamptz, email text, consultant text, scenario text, tag text,
                                           industrie text, date_texte text, score text, evaluation jsonb, transcript text)
   where x.source_id is not null and btrim(x.source_id) <> ''
  on conflict (source, source_id) where source_id is not null do nothing;
  get diagnostics n_ins = row_count;
  return jsonb_build_object('recus', n_recu, 'importes', n_ins, 'ignores', n_recu - n_ins);
end $$;
revoke execute on function public.dojo_importer(jsonb) from public, anon;
grant  execute on function public.dojo_importer(jsonb) to authenticated;

-- Contrôle
select count(*) filter (where source = 'netlify') as importes_netlify, count(*) as total from public.dojo_resultats;
