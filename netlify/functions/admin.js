// netlify/functions/admin.js
// Administration des utilisateurs, côté SERVEUR (privilèges admin Supabase).
// Réservé aux rôles SI et direction. Ne renvoie JAMAIS de mot de passe existant :
// les mots de passe sont hashés par Supabase et ne peuvent pas être lus — on ne
// peut que les RÉINITIALISER.
//
// Profil « Membre Codir » : « set_role » accepte en plus, FACULTATIVEMENT, `codir` (vrai ou faux, strictement un booléen) = profil complémentaire
// au rôle de la personne. Absent : la colonne n'est pas touchée (l'écran Admin d'origine, qui ne l'envoie pas, ne l'efface donc jamais).
// « list » renvoie `codir` (faux tant que membre_codir.sql n'est pas exécuté). Réservé, comme tout le reste, à l'admin et à la direction.
//
// Obeya : « set_role » accepte en plus, FACULTATIVEMENT, `fonctions` (tableau de codes de fonction) = fonctions
// supplémentaires d'une personne. Absent : la colonne n'est pas touchée. « list » renvoie `fonctions` (tableau vide
// tant que obeya_admin.sql n'est pas exécuté : l'écran Admin continue alors de fonctionner comme avant).

const { createClient } = require('@supabase/supabase-js');

function admin() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Vérifie que l'appelant est SI ou direction
async function requireAdmin(authHeader) {
  if (!authHeader) return { ok: false, code: 401, msg: 'Non authentifié' };
  const token = authHeader.replace('Bearer ', '').trim();
  const sb = admin();
  const { data: userData, error } = await sb.auth.getUser(token);
  if (error || !userData?.user) return { ok: false, code: 401, msg: 'Token invalide' };
  const email = (userData.user.email || '').toLowerCase();
  const { data: access } = await sb
    .from('user_access').select('is_admin, role').eq('email', email).maybeSingle();
  const role = access && access.role;
  const autorise = access && (access.is_admin === true || role === 'direction' || role === 'eric' || role === 'si');
  if (!autorise) return { ok: false, code: 403, msg: 'Accès réservé au SI et à la direction' };
  return { ok: true, email };
}

// Fonctions supplémentaires : codes en minuscules (lettres et _), 2 à 30 caractères, 8 au plus, sans doublon.
function cleanFonctions(v) {
  if (!Array.isArray(v)) return { error: 'fonctions doit être un tableau' };
  const out = [];
  for (const x of v) {
    const c = String(x == null ? '' : x).trim().toLowerCase();
    if (!c) continue;
    if (!/^[a-z_]{2,30}$/.test(c)) return { error: 'code de fonction invalide : ' + c };
    if (out.indexOf(c) < 0) out.push(c);
  }
  if (out.length > 8) return { error: 'au plus 8 fonctions supplémentaires par personne' };
  return { value: out };
}

function genPassword() {
  // mot de passe temporaire lisible (à transmettre puis à changer par l'utilisateur)
  const mots = ['Gemba', 'Kaizen', 'Terrain', 'Cap', 'Standard', 'Rituel'];
  const m = mots[Math.floor(Math.random() * mots.length)];
  const n = Math.floor(1000 + Math.random() * 9000);
  const sym = '!@#$%'[Math.floor(Math.random() * 5)];
  return `${m}-${n}${sym}`;
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': process.env.APP_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };

  const guard = await requireAdmin(event.headers.authorization || event.headers.Authorization);
  if (!guard.ok) return { statusCode: guard.code, headers: cors, body: JSON.stringify({ error: guard.msg }) };

  const sb = admin();
  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch (e) {}
  const action = body.action || (event.queryStringParameters && event.queryStringParameters.action) || 'list';

  try {
    // ---- LISTER les utilisateurs (jamais de mot de passe) ----
    if (action === 'list') {
      // rôles depuis user_access
      // « * » : fonctionne que les colonnes facultatives (fonctions, codir) existent déjà ou non ; seuls les champs ci-dessous sont renvoyés
      const { data: accessRows } = await sb.from('user_access').select('*');
      const accessByEmail = {};
      (accessRows || []).forEach(r => { accessByEmail[(r.email || '').toLowerCase()] = r; });
      // comptes d'auth (pour statut / dernière connexion)
      const { data: list, error } = await sb.auth.admin.listUsers();
      if (error) throw error;
      const users = (list.users || []).map(u => {
        const a = accessByEmail[(u.email || '').toLowerCase()] || {};
        return {
          id: u.id,
          email: u.email,
          role: a.role || '—',
          is_admin: a.is_admin === true,
          fonctions: Array.isArray(a.fonctions) ? a.fonctions : [],
          codir: a.codir === true,
          confirme: Boolean(u.email_confirmed_at || u.confirmed_at),
          derniere_connexion: u.last_sign_in_at || null,
          desactive: Boolean(u.banned_until && new Date(u.banned_until) > new Date()),
        };
      });
      return { statusCode: 200, headers: cors, body: JSON.stringify({ users }) };
    }

    // ---- CHANGER le rôle / les droits ----
    if (action === 'set_role') {
      const email = (body.email || '').toLowerCase();
      if (!email) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'email requis' }) };
      const role = body.role || '—';
      const is_admin = Boolean(body.is_admin);
      const row = { email, role, is_admin };
      if (body.fonctions !== undefined) {                                    // facultatif : absent = colonne non touchée
        const f = cleanFonctions(body.fonctions);
        if (f.error) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: f.error }) };
        row.fonctions = f.value;
      }
      if (body.codir !== undefined) {                                        // facultatif : absent = colonne non touchée
        if (typeof body.codir !== 'boolean') return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'codir doit être vrai ou faux' }) };
        row.codir = body.codir;
      }
      const { error } = await sb.from('user_access').upsert(row, { onConflict: 'email' });
      if (error) {
        if (row.codir !== undefined && /codir/i.test(String(error.message || ''))) {
          return { statusCode: 409, headers: cors, body: JSON.stringify({ error: 'Exécutez d’abord membre_codir.sql (colonne « codir » absente).' }) };
        }
        if (row.fonctions !== undefined && /fonctions|column|schema cache/i.test(String(error.message || ''))) {
          return { statusCode: 409, headers: cors, body: JSON.stringify({ error: 'Exécutez d’abord obeya_admin.sql (colonne « fonctions » absente).' }) };
        }
        throw error;
      }
      return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
    }

    // ---- AJOUTER un utilisateur (email + rôle + mot de passe initial) ----
    if (action === 'create') {
      const email = (body.email || '').toLowerCase();
      if (!email) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'email requis' }) };
      const role = body.role || '—';
      const is_admin = Boolean(body.is_admin);
      const password = body.password && body.password.length >= 8 ? body.password : genPassword();
      const { data, error } = await sb.auth.admin.createUser({
        email, password, email_confirm: true,
      });
      if (error) throw error;
      await sb.from('user_access').upsert({ email, role, is_admin }, { onConflict: 'email' });
      // on renvoie le mot de passe UNE SEULE FOIS (celui qu'on vient de définir), à transmettre
      return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, email, motDePasseInitial: password }) };
    }

    // ---- INVITER un utilisateur par e-mail (il définit lui-même son mot de passe) ----
    if (action === 'invite') {
      const email = (body.email || '').toLowerCase();
      if (!email) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'email requis' }) };
      const role = body.role || '';
      const is_admin = Boolean(body.is_admin);
      const opts = process.env.APP_URL ? { redirectTo: process.env.APP_URL } : undefined;
      const { data: inv, error } = await sb.auth.admin.inviteUserByEmail(email, opts);
      if (error) throw error;
      await sb.from('user_access').upsert({ email, role, is_admin }, { onConflict: 'email' });
      // auto-provision : tout utilisateur invité devient pilote sélectionnable
      try {
        const uid = inv && inv.user ? inv.user.id : null;
        if (uid) {
          const nom = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          const { data: ex } = await sb.from('action_pilotes').select('id').eq('user_id', uid).maybeSingle();
          if (!ex) await sb.from('action_pilotes').insert({ nom, user_id: uid, email, actif: true });
          else await sb.from('action_pilotes').update({ email, actif: true }).eq('user_id', uid);
        }
      } catch (e) {}
      return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, email }) };
    }

    // ---- RENVOYER le mot de passe (e-mail de réinitialisation, l'utilisateur le redéfinit) ----
    if (action === 'recovery') {
      const email = (body.email || '').toLowerCase();
      if (!email) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'email requis' }) };
      const opts = process.env.APP_URL ? { redirectTo: process.env.APP_URL } : undefined;
      const { error } = await sb.auth.resetPasswordForEmail(email, opts);
      if (error) throw error;
      return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, email }) };
    }

    // ---- RÉINITIALISER le mot de passe (génère un nouveau, jamais lit l'ancien) ----
    if (action === 'reset_password') {
      const userId = body.id;
      if (!userId) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'id requis' }) };
      const nouveau = body.password && body.password.length >= 8 ? body.password : genPassword();
      const { error } = await sb.auth.admin.updateUserById(userId, { password: nouveau });
      if (error) throw error;
      // renvoyé une seule fois pour transmission à l'utilisateur, à changer ensuite
      return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, nouveauMotDePasse: nouveau }) };
    }

    // ---- DÉSACTIVER / RÉACTIVER un accès ----
    if (action === 'toggle_active') {
      const userId = body.id;
      if (!userId) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'id requis' }) };
      const desactiver = Boolean(body.desactiver);
      // ban de 100 ans = désactivé ; 'none' = réactivé
      const { error } = await sb.auth.admin.updateUserById(userId, { ban_duration: desactiver ? '876000h' : 'none' });
      if (error) throw error;
      return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'action inconnue' }) };
  } catch (e) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};
