-- =====================================================================
-- COCKPIT KW — Suppression de simulations du Dojo (direction uniquement)
-- À exécuter APRÈS dojo_acces.sql et dojo_import.sql. Idempotent (relançable).
--   · dojo_supprimer(ids) : supprime définitivement les simulations désignées ; réservé à la direction (CEO / administrateurs) ;
--   · un rapport de l'ancien Dojo supprimé est noté dans dojo_supprimes : un nouvel import ne le fait PAS revenir ;
--   · la table reste fermée à tous les autres (aucune règle DELETE pour l'application).
-- =====================================================================

create table if not exists public.dojo_supprimes (
  source text not null, source_id text not null, supprime_par text, supprime_le timestamptz default now(),
  primary key (source, source_id)
);
alter table public.dojo_supprimes enable row level security;
revoke all on public.dojo_supprimes from anon, authenticated;

create or replace function public.dojo_supprimer(p_ids text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if public.dojo_role() is distinct from 'eric' then
    raise exception 'Suppression réservée à la direction.' using errcode = '42501';
  end if;
  insert into public.dojo_supprimes (source, source_id, supprime_par)
  select r.source, r.source_id, lower(coalesce(auth.jwt() ->> 'email', ''))
    from public.dojo_resultats r
   where r.id::text = any(p_ids) and r.source is not null and r.source_id is not null
  on conflict do nothing;
  delete from public.dojo_resultats r where r.id::text = any(p_ids);
  get diagnostics n = row_count;
  return jsonb_build_object('supprimes', n);
end $$;
revoke execute on function public.dojo_supprimer(text[]) from public, anon;
grant  execute on function public.dojo_supprimer(text[]) to authenticated;

-- L'import ignore désormais les rapports supprimés
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
     and not exists (select 1 from public.dojo_supprimes d where d.source = 'netlify' and d.source_id = x.source_id)
  on conflict (source, source_id) where source_id is not null do nothing;
  get diagnostics n_ins = row_count;
  return jsonb_build_object('recus', n_recu, 'importes', n_ins, 'ignores', n_recu - n_ins);
end $$;
revoke execute on function public.dojo_importer(jsonb) from public, anon;
grant  execute on function public.dojo_importer(jsonb) to authenticated;

-- Contrôle
select (select count(*) from public.dojo_resultats) as simulations, (select count(*) from public.dojo_supprimes) as supprimees_ancien_dojo;
