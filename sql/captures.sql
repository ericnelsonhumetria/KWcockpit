-- =====================================================================
-- COCKPIT KW — Captures terrain (onglet « Capture » de Clap! + onglet « Captures » du Cockpit)
-- Idempotent (relançable). Ne supprime AUCUNE donnée. À exécuter APRÈS dojo_acces.sql (réutilise dojo_role / dojo_peut).
--   · captures : une situation vue sur le terrain (photo / vidéo / audio + texte), classée Succès / Problème / Opportunité / Risque,
--     horodatée et géolocalisée, rattachée à un sujet et à un projet.
--   · Fichiers dans le dossier de stockage privé « captures » (50 Mo max par fichier), rangés par personne : <user_id>/<capture_id>/…
--   · Droits : chacun crée, voit, corrige et supprime SES captures. Voir TOUTES les captures (onglet « Captures » du Cockpit) :
--     case « Captures » de la matrice Admin → Accès par fonction ; par défaut direction (CEO / administrateurs) et CTO ;
--     ou profil Membre Codir si la case y est cochée. Ceux qui voient tout peuvent aussi marquer « traité » et créer l'action.
-- =====================================================================

-- 1) Qui voit toutes les captures ?
create or replace function public.capture_voit_tout() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r text := public.dojo_role(); v boolean;
begin
  if r is null then return false; end if;
  select case when jsonb_typeof(ra.tabs -> 'capture') = 'boolean' then (ra.tabs ->> 'capture')::boolean end
    into v from public.role_access ra where ra.role = r limit 1;
  if coalesce(v, r in ('eric', 'cto')) then return true; end if;
  return public.dojo_peut('capture');                                    -- profil Membre Codir (case cochée dans son profil)
end $$;
revoke execute on function public.capture_voit_tout() from public, anon;
grant  execute on function public.capture_voit_tout() to authenticated;

-- 2) Les captures
create table if not exists public.captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  auteur_email text default lower(coalesce(auth.jwt() ->> 'email', '')),
  auteur_nom text,
  categorie text not null check (categorie in ('succes', 'probleme', 'opportunite', 'risque')),
  sujet text,
  projet text,
  description text,
  medias jsonb not null default '[]'::jsonb,          -- [{ "path": "...", "type": "photo|video|audio", "mime": "...", "taille": 123, "duree": 12.3 }]
  capture_le timestamptz not null default now(),     -- heure de la prise de vue (téléphone)
  cree_le timestamptz not null default now(),        -- heure d'enregistrement (serveur)
  lat double precision, lng double precision, precision_m double precision,
  lieu text,                                         -- adresse approximative (OpenStreetMap), si disponible
  statut text not null default 'nouveau' check (statut in ('nouveau', 'traite')),
  action_id uuid,
  traite_par text, traite_le timestamptz
);
create index if not exists captures_date_idx on public.captures (capture_le desc);
create index if not exists captures_user_idx on public.captures (user_id, capture_le desc);
alter table public.captures enable row level security;
revoke all on public.captures from anon;
grant select, insert, update, delete on public.captures to authenticated;

drop policy if exists captures_lecture on public.captures;
create policy captures_lecture on public.captures for select to authenticated using (user_id = auth.uid() or public.capture_voit_tout());
drop policy if exists captures_creation on public.captures;
create policy captures_creation on public.captures for insert to authenticated with check (user_id = auth.uid());
drop policy if exists captures_modification on public.captures;
create policy captures_modification on public.captures for update to authenticated
  using (user_id = auth.uid() or public.capture_voit_tout()) with check (user_id = auth.uid() or public.capture_voit_tout());
drop policy if exists captures_suppression on public.captures;
create policy captures_suppression on public.captures for delete to authenticated using (user_id = auth.uid() or public.capture_voit_tout());

-- L'auteur et l'horodatage ne se falsifient pas : user_id / auteur_email / cree_le sont fixés par la base
create or replace function public.captures_garde() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.user_id := auth.uid(); new.auteur_email := lower(coalesce(auth.jwt() ->> 'email', new.auteur_email)); end if;
    new.cree_le := now();
    if new.capture_le is null or new.capture_le > now() + interval '10 minutes' then new.capture_le := now(); end if;
  else
    new.user_id := old.user_id; new.auteur_email := old.auteur_email; new.cree_le := old.cree_le;
    if new.statut is distinct from old.statut then
      new.traite_par := case when new.statut = 'traite' then lower(coalesce(auth.jwt() ->> 'email', '')) end;
      new.traite_le := case when new.statut = 'traite' then now() end;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists captures_garde on public.captures;
create trigger captures_garde before insert or update on public.captures for each row execute function public.captures_garde();

-- 3) Stockage des fichiers (dossier privé « captures »)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('captures', 'captures', false, 52428800, array['image/*', 'video/*', 'audio/*'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists captures_fichiers_depot on storage.objects;
create policy captures_fichiers_depot on storage.objects for insert to authenticated
  with check (bucket_id = 'captures' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists captures_fichiers_lecture on storage.objects;
create policy captures_fichiers_lecture on storage.objects for select to authenticated
  using (bucket_id = 'captures' and ((storage.foldername(name))[1] = auth.uid()::text or public.capture_voit_tout()));
drop policy if exists captures_fichiers_suppression on storage.objects;
create policy captures_fichiers_suppression on storage.objects for delete to authenticated
  using (bucket_id = 'captures' and ((storage.foldername(name))[1] = auth.uid()::text or public.capture_voit_tout()));

-- Contrôle
select (select count(*) from storage.buckets where id = 'captures') as dossier_ok,                 -- 1 attendu
       (select count(*) from pg_policies where tablename = 'captures') as regles_table,             -- 4 attendu
       (select count(*) from public.captures) as captures;
