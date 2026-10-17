-- =====================================================================
-- COCKPIT KW — Organisation des comptes-rendus : type de réunion et dossier (client, projet)
-- Idempotent (relançable). Ne supprime AUCUNE donnée. Ne change AUCUN droit d'accès.
--   · type_reunion : 'rituel' | 'rdv' | 'autre' ; vide = automatique (AIC et Obeya sont toujours reconnus d'après leur lien).
--   · dossier      : texte libre (Andros, Humetria…) ; vide = « Sans dossier » (ou le client de la mission pour un CR d'AIC).
-- Sans ce script, la page fonctionne : le type est déduit, et le champ Dossier ainsi que « Ranger les CR sans dossier » n'apparaissent pas.
-- =====================================================================
alter table public.comptes_rendus add column if not exists type_reunion text;
alter table public.comptes_rendus add column if not exists dossier text;
do $$ begin
  alter table public.comptes_rendus add constraint comptes_rendus_type_reunion_chk check (type_reunion is null or type_reunion in ('rituel', 'rdv', 'autre'));
exception when duplicate_object then null; end $$;
create index if not exists comptes_rendus_dossier_idx on public.comptes_rendus (lower(dossier));

-- Contrôle
select count(*) as comptes_rendus, count(dossier) as avec_dossier, count(type_reunion) as type_choisi from public.comptes_rendus;
