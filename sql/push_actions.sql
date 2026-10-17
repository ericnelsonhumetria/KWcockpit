-- =====================================================================
-- COCKPIT KW — Clap! : notifications « actions en retard » sur le téléphone, en temps réel
-- Idempotent (relançable). Ne supprime AUCUNE donnée. Ne change aucun droit existant.
--   1) push_abonnements : les téléphones abonnés (un par appareil et par compte) ; chacun ne voit et ne gère que les siens.
--   2) push_config : clés d'envoi et secret, créés automatiquement par la fonction Netlify ; table fermée à tous (clé de service seule).
--   3) Déclencheur sur « actions » : à chaque changement de statut, d'échéance, de pilote, d'archivage ou de libellé, la base prévient
--      la fonction Netlify push-actions (extension pg_net, appel asynchrone) qui met à jour les téléphones des pilotes concernés.
--      Si l'appel échoue, l'enregistrement de l'action n'est JAMAIS bloqué.
-- =====================================================================

create extension if not exists pg_net;

-- 1) Abonnements
create table if not exists public.push_abonnements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  email text,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  dernier_etat text,
  dernier_envoi timestamptz,
  echecs int not null default 0
);
alter table public.push_abonnements enable row level security;
revoke all on public.push_abonnements from anon;
grant select, delete on public.push_abonnements to authenticated;
drop policy if exists push_abonnements_lecture on public.push_abonnements;
create policy push_abonnements_lecture on public.push_abonnements for select to authenticated using (user_id = auth.uid());
drop policy if exists push_abonnements_suppression on public.push_abonnements;
create policy push_abonnements_suppression on public.push_abonnements for delete to authenticated using (user_id = auth.uid());

-- Abonner cet appareil au compte connecté (un même téléphone repris par un autre compte change de propriétaire)
create or replace function public.push_abonner(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_mail text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if v_uid is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then raise exception 'Abonnement invalide.'; end if;
  insert into public.push_abonnements (user_id, email, endpoint, p256dh, auth, user_agent)
  values (v_uid, nullif(v_mail, ''), p_endpoint, p_p256dh, p_auth, left(p_ua, 300))
  on conflict (endpoint) do update set user_id = excluded.user_id, email = excluded.email, p256dh = excluded.p256dh, auth = excluded.auth,
    user_agent = excluded.user_agent, maj_le = now(), echecs = 0,
    dernier_etat = case when push_abonnements.user_id = excluded.user_id then push_abonnements.dernier_etat else null end;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.push_abonner(text, text, text, text) from public, anon;
grant execute on function public.push_abonner(text, text, text, text) to authenticated;

-- 2) Configuration (clés, secret, adresse de la fonction) : personne d'autre que la clé de service
create table if not exists public.push_config (cle text primary key, valeur text not null, maj_le timestamptz not null default now());
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;

-- 3) Déclencheur temps réel
create or replace function public.actions_push_signal() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_url text; v_sec text; v_p text[];
begin
  if tg_op = 'UPDATE' and new.statut is not distinct from old.statut and new.echeance is not distinct from old.echeance
     and new.pilote_id is not distinct from old.pilote_id and new.archived_at is not distinct from old.archived_at
     and new.libelle is not distinct from old.libelle then
    return null;
  end if;
  select valeur into v_url from public.push_config where cle = 'url';
  select valeur into v_sec from public.push_config where cle = 'secret';
  if v_url is null or v_sec is null then return null; end if;          -- personne ne s'est encore abonné
  select array_agg(distinct x) into v_p
    from unnest(array[case when tg_op <> 'INSERT' then old.pilote_id::text end,
                      case when tg_op <> 'DELETE' then new.pilote_id::text end]) as x where x is not null;
  if coalesce(array_length(v_p, 1), 0) = 0 then return null; end if;
  begin
    perform net.http_post(url := v_url, body := jsonb_build_object('pilotes', to_jsonb(v_p)),
                          headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_sec),
                          timeout_milliseconds := 8000);
  exception when others then null;                                   -- jamais bloquant
  end;
  return null;
end $$;
drop trigger if exists actions_push_signal on public.actions;
create trigger actions_push_signal after insert or update or delete on public.actions
  for each row execute function public.actions_push_signal();

-- Contrôle
select (select count(*) from pg_extension where extname = 'pg_net') as pg_net_ok,                                       -- 1 attendu
       (select count(*) from pg_trigger where tgname = 'actions_push_signal') as declencheur_ok,                       -- 1 attendu
       (select count(*) from public.push_abonnements) as telephones_abonnes;
