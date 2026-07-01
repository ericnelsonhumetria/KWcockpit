// netlify/functions/admin.js
// Administration des utilisateurs, côté SERVEUR (privilèges admin Supabase).
// Réservé aux rôles SI et direction. Ne renvoie JAMAIS de mot de passe existant :
// les mots de passe sont hashés par Supabase et ne peuvent pas être lus — on ne
// peut que les RÉINITIALISER.

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
      const { data: accessRows } = await sb.from('user_access').select('email, is_admin, role');
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
      const { error } = await sb.from('user_access')
        .upsert({ email, role, is_admin }, { onConflict: 'email' });
      if (error) throw error;
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
