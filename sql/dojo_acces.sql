-- =====================================================================
-- COCKPIT KW — Accès aux résultats du Dojo (table dojo_resultats)
-- Idempotent (relançable). Ne supprime AUCUNE donnée.
--
-- RÈGLE (la même que l'écran, décidée dans le Cockpit : Admin → Accès par fonction)
--   · chacun voit SES propres simulations ;
--   · voir TOUTES les simulations demande le droit « Dojo — résultats » (case de la matrice, ou profil Membre Codir) ;
--     par défaut : direction (CEO / administrateurs) et Méthodes ;
--   · enregistrer une simulation demande le droit « Dojo », et seulement à son propre nom (e-mail de la connexion) ;
--   · personne ne modifie ni ne supprime un résultat depuis l'application (l'archivage reste un masquage d'affichage).
--   · un rôle inconnu ou absent n'a AUCUN accès (« sans accès, aucun accès »).
--
-- Les règles d'accès ACTUELLES de dojo_resultats sont sauvegardées dans dojo_politiques_avant avant d'être remplacées.
-- Retour arrière : select public.dojo_acces_annuler();
-- =====================================================================

-- 1) Rôle applicatif de la personne connectée (strict : null si inconnu ; même correspondance que le Cockpit)
create or replace function public.dojo_role() returns text
language plpgsql stable security definer set search_path = public as $$
declare r text; adm boolean;
begin
  select lower(btrim(coalesce(ua.role::text, ''))), coalesce(ua.is_admin, false) into r, adm
    from public.user_access ua where lower(ua.email) = lower(coalesce(auth.jwt() ->> 'email', '')) limit 1;
  if not found then return null; end if;
  if adm then return 'eric'; end if;
  return case r
    when 'direction' then 'eric' when 'ceo' then 'eric' when 'eric' then 'eric' when 'si' then 'eric'
    when 'cto' then 'cto'
    when 'communication' then 'communication' when 'comm' then 'communication'
    when 'transformation' then 'transformation'
    when 'commerce' then 'paul' when 'paul' then 'paul'
    when 'mktg et produit' then 'juliette' when 'marketing' then 'juliette' when 'marketing & communication' then 'juliette' when 'juliette' then 'juliette'
    when 'méthodes' then 'audrey' when 'methodes' then 'audrey' when 'réalisation & compétences' then 'audrey' when 'realisation' then 'audrey' when 'audrey' then 'audrey'
    when 'rh' then 'sabrine' when 'sabrine' then 'sabrine'
    when 'administration des affaires' then 'najoua' when 'administration' then 'najoua' when 'finance & admin' then 'najoua' when 'finance' then 'najoua' when 'najoua' then 'najoua'
    when 'consultant' then 'consultant'
    when 'pmo' then 'pmo' when 'project management officer' then 'pmo'
    else null end;
end $$;
revoke execute on function public.dojo_role() from public, anon;
grant  execute on function public.dojo_role() to authenticated;

-- 2) « La personne connectée a-t-elle droit à cet onglet ? » ('dojo' ou 'dojo_resultats') : matrice d'Admin, sinon valeur par défaut, + profil Membre Codir
create or replace function public.dojo_peut(p_onglet text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r text := public.dojo_role(); v boolean; cg boolean; codir boolean := false;
begin
  if r is null then return false; end if;
  select case when jsonb_typeof(ra.tabs -> p_onglet) = 'boolean' then (ra.tabs ->> p_onglet)::boolean end
    into v from public.role_access ra where ra.role = r limit 1;
  v := coalesce(v, case p_onglet
    when 'dojo' then r not in ('consultant', 'communication', 'pmo', 'najoua', 'paul', 'juliette')
    when 'dojo_resultats' then r in ('eric', 'audrey')
    else false end);
  if v then return true; end if;
  begin
    select coalesce(ua.codir, false) into codir from public.user_access ua
     where lower(ua.email) = lower(coalesce(auth.jwt() ->> 'email', '')) limit 1;
  exception when undefined_column then codir := false;            -- membre_codir.sql pas encore exécuté
  end;
  if not coalesce(codir, false) then return false; end if;
  select case when jsonb_typeof(ra.tabs -> p_onglet) = 'boolean' then (ra.tabs ->> p_onglet)::boolean end
    into cg from public.role_access ra where ra.role = 'codir' limit 1;
  return coalesce(cg, false);
end $$;
revoke execute on function public.dojo_peut(text) from public, anon;
grant  execute on function public.dojo_peut(text) to authenticated;

-- 3) Sauvegarde des règles actuelles, puis nouvelles règles
create table if not exists public.dojo_politiques_avant (
  id bigserial primary key, policyname text, permissive text, roles text[], cmd text, qual text, with_check text, sauvegarde_le timestamptz default now()
);
alter table public.dojo_politiques_avant enable row level security;
revoke all on public.dojo_politiques_avant from anon, authenticated;

do $$
declare p record; v_n int := 0;
begin
  for p in select * from pg_policies where schemaname = 'public' and tablename = 'dojo_resultats' and policyname not like 'dojo_%_acces' loop
    if not exists (select 1 from public.dojo_politiques_avant a where a.policyname = p.policyname and a.cmd = p.cmd
                   and a.qual is not distinct from p.qual and a.with_check is not distinct from p.with_check) then
      insert into public.dojo_politiques_avant (policyname, permissive, roles, cmd, qual, with_check)
      values (p.policyname, p.permissive, p.roles, p.cmd, p.qual, p.with_check);
    end if;
    execute format('drop policy %I on public.dojo_resultats', p.policyname);
    v_n := v_n + 1;
  end loop;
  raise notice 'dojo_resultats : % ancienne(s) règle(s) sauvegardée(s) dans dojo_politiques_avant puis remplacée(s).', v_n;
end $$;

alter table public.dojo_resultats enable row level security;

drop policy if exists dojo_select_acces on public.dojo_resultats;
create policy dojo_select_acces on public.dojo_resultats for select to authenticated
  using ( lower(coalesce(email, '')) = lower(coalesce(auth.jwt() ->> 'email', '')) or public.dojo_peut('dojo_resultats') );

drop policy if exists dojo_insert_acces on public.dojo_resultats;
create policy dojo_insert_acces on public.dojo_resultats for insert to authenticated
  with check ( lower(coalesce(email, '')) = lower(coalesce(auth.jwt() ->> 'email', '')) and public.dojo_peut('dojo') );
-- Pas de règle UPDATE ni DELETE : refusés depuis l'application.

-- 4) Retour arrière : rétablit les règles sauvegardées
create or replace function public.dojo_acces_annuler() returns integer
language plpgsql security definer set search_path = public as $$
declare p record; n int := 0;
begin
  drop policy if exists dojo_select_acces on public.dojo_resultats;
  drop policy if exists dojo_insert_acces on public.dojo_resultats;
  for p in select distinct on (policyname, cmd) * from public.dojo_politiques_avant order by policyname, cmd, id desc loop
    execute format('drop policy if exists %I on public.dojo_resultats', p.policyname);
    execute format('create policy %I on public.dojo_resultats as %s for %s to %s %s %s', p.policyname, p.permissive, p.cmd,
      array_to_string(p.roles, ', '),
      case when p.qual is not null then 'using (' || p.qual || ')' else '' end,
      case when p.with_check is not null then 'with check (' || p.with_check || ')' else '' end);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.dojo_acces_annuler() from public, anon, authenticated;

-- 5) Contrôle : règles en vigueur
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'dojo_resultats' order by policyname;
