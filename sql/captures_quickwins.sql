-- =====================================================================
-- COCKPIT KW — Quick wins des captures « Succès »
-- À exécuter APRÈS captures.sql. Idempotent (relançable). Ne supprime AUCUNE donnée.
--   · captures : trame Avant / Action / Après, domaine, pérennité, gains chiffrés (qw_gains), total €/an et h/an, maturité,
--     validation : par l'interlocuteur CLIENT (nom + fonction) ou en INTERNE par le chef de projet Kaizen Way (moins de poids).
--     La date de validation et la personne qui l'a saisie sont fixées par la base.
--   · qw_valorisations : montants standard proposés pour chiffrer (38 €/h par défaut) ; modifiables par la direction ;
--     chaque quick win peut les remplacer (« valorisation manuelle »).
-- =====================================================================

alter table public.captures add column if not exists qw boolean not null default false;
alter table public.captures add column if not exists qw_avant text;
alter table public.captures add column if not exists qw_action text;
alter table public.captures add column if not exists qw_apres text;
alter table public.captures add column if not exists qw_domaine text;
alter table public.captures add column if not exists qw_perennite text;
alter table public.captures add column if not exists qw_gains jsonb not null default '[]'::jsonb;
alter table public.captures add column if not exists qw_gain_eur numeric;
alter table public.captures add column if not exists qw_gain_h numeric;
alter table public.captures add column if not exists qw_maturite text;
alter table public.captures add column if not exists qw_validation text;
alter table public.captures add column if not exists qw_valide_nom text;
alter table public.captures add column if not exists qw_valide_fonction text;
alter table public.captures add column if not exists qw_valide_le timestamptz;
alter table public.captures add column if not exists qw_valide_saisi_par text;
do $$ begin
  alter table public.captures add constraint captures_qw_validation_chk check (qw_validation is null or qw_validation in ('client', 'kw'));
exception when duplicate_object then null; end $$;
create index if not exists captures_qw_idx on public.captures (capture_le desc) where qw;

-- Garde-fou : on y ajoute l'horodatage de la validation (date + personne qui l'a saisie), non falsifiables
create or replace function public.captures_garde() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.user_id := auth.uid(); new.auteur_email := lower(coalesce(auth.jwt() ->> 'email', new.auteur_email)); end if;
    new.cree_le := now();
    if new.capture_le is null or new.capture_le > now() + interval '10 minutes' then new.capture_le := now(); end if;
    if new.qw_validation is not null then new.qw_valide_le := now(); new.qw_valide_saisi_par := lower(coalesce(auth.jwt() ->> 'email', '')); end if;
  else
    new.user_id := old.user_id; new.auteur_email := old.auteur_email; new.cree_le := old.cree_le;
    if new.statut is distinct from old.statut then
      new.traite_par := case when new.statut = 'traite' then lower(coalesce(auth.jwt() ->> 'email', '')) end;
      new.traite_le := case when new.statut = 'traite' then now() end;
    end if;
    if new.qw_validation is distinct from old.qw_validation or new.qw_valide_nom is distinct from old.qw_valide_nom or new.qw_valide_fonction is distinct from old.qw_valide_fonction then
      new.qw_valide_le := case when new.qw_validation is not null then now() end;
      new.qw_valide_saisi_par := case when new.qw_validation is not null then lower(coalesce(auth.jwt() ->> 'email', '')) end;
    else
      new.qw_valide_le := old.qw_valide_le; new.qw_valide_saisi_par := old.qw_valide_saisi_par;
    end if;
  end if;
  return new;
end $$;

-- Valorisations standard
create table if not exists public.qw_valorisations (
  type text primary key check (type in ('temps', 'deplacement', 'qualite', 'consommation', 'securite')),
  libelle text not null, unite text not null, valeur numeric not null default 0, ordre int not null default 0,
  maj_le timestamptz not null default now(), maj_par text
);
insert into public.qw_valorisations (type, libelle, unite, valeur, ordre) values
  ('temps', 'Temps gagné', '€ par heure (coût horaire chargé)', 38, 1),
  ('deplacement', 'Déplacements évités', '€ par heure (coût horaire chargé)', 38, 2),
  ('qualite', 'Non-qualité / rebuts', '€ par pièce', 0, 3),
  ('consommation', 'Consommation (matière, énergie)', '€ par unité', 0, 4),
  ('securite', 'Sécurité', 'non monétisée', 0, 5)
on conflict (type) do nothing;
alter table public.qw_valorisations enable row level security;
revoke all on public.qw_valorisations from anon;
grant select, update on public.qw_valorisations to authenticated;
drop policy if exists qw_valorisations_lecture on public.qw_valorisations;
create policy qw_valorisations_lecture on public.qw_valorisations for select to authenticated using (true);
drop policy if exists qw_valorisations_direction on public.qw_valorisations;
create policy qw_valorisations_direction on public.qw_valorisations for update to authenticated
  using (public.dojo_role() = 'eric') with check (public.dojo_role() = 'eric');
create or replace function public.qw_valorisations_maj() returns trigger language plpgsql security definer set search_path = public as $$
begin new.maj_le := now(); new.maj_par := lower(coalesce(auth.jwt() ->> 'email', '')); new.type := old.type; return new; end $$;
drop trigger if exists qw_valorisations_maj on public.qw_valorisations;
create trigger qw_valorisations_maj before update on public.qw_valorisations for each row execute function public.qw_valorisations_maj();

-- Contrôle
select (select count(*) from information_schema.columns where table_name = 'captures' and column_name like 'qw%') as colonnes_qw,   -- 15 attendu
       (select count(*) from public.qw_valorisations) as valorisations;                                                           -- 5 attendu
