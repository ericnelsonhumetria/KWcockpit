-- =====================================================================
-- COCKPIT KW — Classement des comptes-rendus : glisser-déposer, renommer les dossiers et les types (direction)
-- À exécuter APRÈS cr_organisation.sql et cr_confidentiel.sql. Idempotent (relançable). Ne supprime AUCUNE donnée.
--   1) Le dossier et le type d'un CR sont du CLASSEMENT, pas du contenu : on peut les changer même sur un CR verrouillé
--      (le garde-fou du verrou les ignore désormais, comme le statut). Qui peut les changer : ceux qui peuvent déjà modifier le CR.
--   2) cr_dossier_renommer(ancien, nouveau) : la direction renomme (ou fusionne) un dossier sur TOUS les CR, y compris ceux qu'elle ne
--      voit pas et les CR d'AIC rangés d'office sous le client de leur mission.
--   3) cr_type_libelles + cr_type_renommer(code, libellé) : la direction renomme l'intitulé d'un type (AIC, Obeya, Rituels…).
-- ATTENTION : si cr_confidentiel.sql est rejoué un jour, rejouer ce script juste après (il redéfinit le même garde-fou).
-- =====================================================================

-- 1) Garde-fou du verrou : identique à cr_confidentiel.sql, avec « dossier » et « type_reunion » en plus dans les champs libres
create or replace function public.cr_verrou_guard() returns trigger
language plpgsql as $$
declare
  v_via_fonction boolean := coalesce(current_setting('kw.cr_verrou', true), '') = 'on';
  v_via_suppr boolean := coalesce(current_setting('kw.cr_suppr', true), '') = 'on';
  v_exempt text[] := array['statut', 'actions_numeros', 'transcription_par', 'transcription_le', 'updated_at', 'auteur_id', 'verrouille_le', 'verrouille_par', 'confidentiel',
                           'dossier', 'type_reunion'];
begin
  if auth.uid() is null and current_user not in ('anon', 'authenticated') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.auteur_id := auth.uid();
    new.verrouille_le := null; new.verrouille_par := null;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.verrouille_le is not null and not v_via_suppr then
      raise exception 'Compte-rendu verrouillé par son auteur : seul l''animateur de la réunion peut le supprimer (bouton Supprimer).' using errcode = '42501';
    end if;
    return old;
  end if;
  if not v_via_fonction and (new.auteur_id is distinct from old.auteur_id or new.verrouille_le is distinct from old.verrouille_le
                             or new.verrouille_par is distinct from old.verrouille_par or new.confidentiel is distinct from old.confidentiel) then
    raise exception 'Le verrou et la confidentialité d''un compte-rendu se règlent uniquement avec les boutons Verrouiller / Déverrouiller / Confidentiel.' using errcode = '42501';
  end if;
  if old.verrouille_le is not null and (to_jsonb(new) - v_exempt) is distinct from (to_jsonb(old) - v_exempt) then
    raise exception 'Compte-rendu verrouillé par son auteur : déverrouillez-le avant de le modifier.' using errcode = '42501';
  end if;
  return new;
end $$;

-- 2) Renommer / fusionner un dossier (direction)
create or replace function public.cr_dossier_renommer(p_ancien text, p_nouveau text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a text := btrim(coalesce(p_ancien, '')); n text := nullif(btrim(coalesce(p_nouveau, '')), ''); k1 int := 0; k2 int := 0;
begin
  if not public.cr_est_direction() then raise exception 'Réservé à la direction.' using errcode = '42501'; end if;
  if a = '' then raise exception 'Dossier d''origine manquant.'; end if;
  update public.comptes_rendus set dossier = n where lower(btrim(dossier)) = lower(a);
  get diagnostics k1 = row_count;
  begin   -- CR d'AIC sans dossier, rangés d'office sous le client de leur mission
    update public.comptes_rendus c set dossier = n
      from public.aic_espaces e join public.aic_missions m on m.id = e.mission_id
     where c.dossier is null and c.aic_espace_id is not null and e.id::text = c.aic_espace_id::text and lower(btrim(m.client)) = lower(a)
       and n is not null and lower(n) <> lower(a);
    get diagnostics k2 = row_count;
  exception when undefined_table or undefined_column then k2 := 0;
  end;
  return jsonb_build_object('modifies', k1 + k2);
end $$;
revoke execute on function public.cr_dossier_renommer(text, text) from public, anon;
grant  execute on function public.cr_dossier_renommer(text, text) to authenticated;

-- 3) Intitulés des types (lecture : tous les comptes connectés ; écriture : direction, par la fonction)
create table if not exists public.cr_type_libelles (code text primary key check (code in ('aic', 'obeya', 'rituel', 'rdv', 'autre')), libelle text not null, maj_le timestamptz default now(), maj_par text);
alter table public.cr_type_libelles enable row level security;
revoke all on public.cr_type_libelles from anon;
grant select on public.cr_type_libelles to authenticated;
drop policy if exists cr_type_libelles_lecture on public.cr_type_libelles;
create policy cr_type_libelles_lecture on public.cr_type_libelles for select to authenticated using (true);

create or replace function public.cr_type_renommer(p_code text, p_libelle text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l text := nullif(btrim(coalesce(p_libelle, '')), '');
begin
  if not public.cr_est_direction() then raise exception 'Réservé à la direction.' using errcode = '42501'; end if;
  if p_code not in ('aic', 'obeya', 'rituel', 'rdv', 'autre') then raise exception 'Type inconnu : %', p_code; end if;
  if l is null then delete from public.cr_type_libelles where code = p_code;                 -- vide = intitulé d'origine
  else insert into public.cr_type_libelles (code, libelle, maj_par) values (p_code, left(l, 60), lower(coalesce(auth.jwt() ->> 'email', '')))
       on conflict (code) do update set libelle = excluded.libelle, maj_le = now(), maj_par = excluded.maj_par;
  end if;
  return jsonb_build_object('code', p_code, 'libelle', l);
end $$;
revoke execute on function public.cr_type_renommer(text, text) from public, anon;
grant  execute on function public.cr_type_renommer(text, text) to authenticated;

-- Contrôle
select (select count(*) from pg_proc where proname in ('cr_dossier_renommer', 'cr_type_renommer')) as fonctions_ok,   -- 2 attendu
       (select count(*) from public.cr_type_libelles) as types_renommes;
