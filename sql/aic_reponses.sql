-- =====================================================================
-- COCKPIT KW — AIC : « pas de rouge sans réponse »
-- Idempotent (relançable). Ne supprime AUCUNE donnée. Ne change AUCUN droit : qui peut saisir un relevé peut y attacher sa réponse.
--   reponse     : 'action' (une action Clap! a été créée) ou 'remontee' (un sujet a été remonté) ; vide = rouge sans réponse
--   reponse_ref : n° de l'action (#123) ou identifiant du sujet
--   reponse_par / reponse_le : qui a répondu, et quand
-- Le mur de performance compte les rouges des 4 dernières semaines sans réponse ; le tableau de bord d'un espace les liste avec
-- les boutons « Créer une action » et « Remonter en sujet ». La cause de l'écart reste le commentaire du relevé.
-- =====================================================================
alter table public.aic_statuts add column if not exists reponse text;
alter table public.aic_statuts add column if not exists reponse_ref text;
alter table public.aic_statuts add column if not exists reponse_par text;
alter table public.aic_statuts add column if not exists reponse_le timestamptz;
do $$ begin
  alter table public.aic_statuts add constraint aic_statuts_reponse_chk check (reponse is null or reponse in ('action', 'remontee'));
exception when duplicate_object then null; end $$;
create index if not exists aic_statuts_rouges_idx on public.aic_statuts (espace_id, jour) where statut = 'rouge' and reponse is null;

-- Contrôle : rouges des 4 dernières semaines, avec / sans réponse
select count(*) filter (where reponse is null) as rouges_sans_reponse, count(*) filter (where reponse is not null) as rouges_avec_reponse
  from public.aic_statuts where statut = 'rouge' and jour >= current_date - 27;
