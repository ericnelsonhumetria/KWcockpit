-- ============================================================
-- Cockpit KW — Schéma Supabase (système de management)
-- À exécuter dans Supabase → SQL Editor.
-- Réutilise la table user_access existante de Nelson Management.
-- RLS activée : la base elle-même filtre les accès.
-- ============================================================

-- Helper : email de l'utilisateur courant
-- (Supabase expose auth.jwt() ; on lit l'email du token)
create or replace function current_email() returns text as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$ language sql stable;

-- Helper : l'utilisateur courant est-il direction ?
create or replace function is_direction() returns boolean as $$
  select exists (
    select 1 from user_access
    where lower(email) = current_email()
      and (is_admin = true or role in ('direction','eric'))
  );
$$ language sql stable;

-- ============================================================
-- COCKPIT_STATE : persistance du front (une ligne JSON par domaine)
-- C'est la table réellement utilisée par public/index.html.
-- Les tables détaillées ci-dessous (actions, objectifs…) sont
-- fournies pour une V2 « normalisée » ; le front actuel s'appuie
-- sur cockpit_state pour rester proche de la maquette.
-- ============================================================
create table if not exists cockpit_state (
  cle text primary key,
  valeur jsonb not null,
  updated_at timestamptz default now()
);
alter table cockpit_state enable row level security;
-- Lecture : tout utilisateur authentifié
create policy cockpit_state_read on cockpit_state for select to authenticated using (true);
-- Écriture : tout utilisateur authentifié (le cloisonnement fin par
-- domaine se fait dans l'app ; pour une vraie restriction par rôle,
-- éclater en tables dédiées avec les policies de la V2 ci-dessous).
create policy cockpit_state_write on cockpit_state for all to authenticated
  using (true) with check (true);

-- ============================================================
-- TABLES NORMALISÉES (V2 — non utilisées par le front actuel,
-- fournies pour évolution vers un cloisonnement strict par rôle)
-- ============================================================
create table if not exists actions (
  id uuid primary key default gen_random_uuid(),
  titre text not null,
  porteur text,                -- nom du porteur (ou email)
  echeance date,
  statut text default 'à faire',
  origine text,                -- Copil, CODIR, Pipeline, Onboarding…
  source text,                 -- Notion/réunion, HubSpot, Qonto (informatif)
  lie_a text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table actions enable row level security;
-- Lecture : tous les utilisateurs authentifiés
create policy actions_read on actions for select to authenticated using (true);
-- Écriture : le porteur de l'action OU la direction
create policy actions_write on actions for all to authenticated
  using (is_direction() or porteur = current_email() or created_by = current_email())
  with check (is_direction() or porteur = current_email() or created_by = current_email());

-- ============================================================
-- OBJECTIFS (OKR) — édition réservée direction
-- ============================================================
create table if not exists objectifs (
  id uuid primary key default gen_random_uuid(),
  intitule text not null,
  cible text,
  echeance text,
  resp text,
  statut text default 'à lancer',
  updated_at timestamptz default now()
);
alter table objectifs enable row level security;
create policy objectifs_read on objectifs for select to authenticated using (true);
create policy objectifs_write on objectifs for all to authenticated
  using (is_direction()) with check (is_direction());

-- ============================================================
-- PROCESSUS (propriétaires) — édition réservée direction
-- ============================================================
create table if not exists processus (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  groupe text,                 -- Chaîne de valeur / Pilotage / Support
  step text,                   -- clé frise (demande, r1, r2…) ou null
  proprietaire text,
  backup text,
  ordre int default 0
);
alter table processus enable row level security;
create policy processus_read on processus for select to authenticated using (true);
create policy processus_write on processus for all to authenticated
  using (is_direction()) with check (is_direction());

-- ============================================================
-- COMPETENCES (colonnes de la matrice)
-- ============================================================
create table if not exists competences (
  id uuid primary key default gen_random_uuid(),
  libelle text not null,
  ordre int default 0
);
alter table competences enable row level security;
create policy competences_read on competences for select to authenticated using (true);
-- Écriture : direction + Audrey (réalisation/compétences)
create policy competences_write on competences for all to authenticated
  using (is_direction() or current_email() like 'audrey%')
  with check (is_direction() or current_email() like 'audrey%');

-- ============================================================
-- CONSULTANTS (lignes de la matrice)
-- ============================================================
create table if not exists consultants (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  actif boolean default true
);
alter table consultants enable row level security;
create policy consultants_read on consultants for select to authenticated using (true);
create policy consultants_write on consultants for all to authenticated
  using (is_direction() or current_email() like 'audrey%')
  with check (is_direction() or current_email() like 'audrey%');

-- ============================================================
-- NIVEAUX (matrice = consultant × compétence)
-- ============================================================
create table if not exists niveaux (
  id uuid primary key default gen_random_uuid(),
  consultant_id uuid references consultants(id) on delete cascade,
  competence text,             -- libellé compétence
  niveau text default '—'      -- — / Initié / Confirmé / Expert
);
alter table niveaux enable row level security;
create policy niveaux_read on niveaux for select to authenticated using (true);
create policy niveaux_write on niveaux for all to authenticated
  using (is_direction() or current_email() like 'audrey%')
  with check (is_direction() or current_email() like 'audrey%');

-- ============================================================
-- BIBLIOTHEQUE (livrables Go Gemba® par phase)
-- ============================================================
create table if not exists bibliotheque (
  id uuid primary key default gen_random_uuid(),
  phase text not null,
  titre text not null,
  avancement int default 0     -- 0 / 25 / 50 / 75 / 100
);
alter table bibliotheque enable row level security;
create policy bibliotheque_read on bibliotheque for select to authenticated using (true);
create policy bibliotheque_write on bibliotheque for all to authenticated
  using (is_direction() or current_email() like 'audrey%')
  with check (is_direction() or current_email() like 'audrey%');

-- ============================================================
-- MISSIONS (santé des missions)
-- ============================================================
create table if not exists missions (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  lead text,
  secteur text,                -- industrie / services
  planning text,
  standards text,
  risque_opp text
);
alter table missions enable row level security;
create policy missions_read on missions for select to authenticated using (true);
create policy missions_write on missions for all to authenticated
  using (is_direction() or current_email() like 'audrey%' or current_email() like 'arnaud%')
  with check (is_direction() or current_email() like 'audrey%' or current_email() like 'arnaud%');

-- ============================================================
-- NOTE : adapter les patterns d'email (like 'audrey%') à vos
-- vraies adresses, ou ajouter une colonne 'role' dans user_access
-- et filtrer dessus pour plus de robustesse.
-- ============================================================
