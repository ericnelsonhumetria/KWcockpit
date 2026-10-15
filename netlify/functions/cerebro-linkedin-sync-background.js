// netlify/functions/cerebro-linkedin-sync-background.js  (v1)
// SYNCHRONISATION AUTOMATIQUE DES RELATIONS LINKEDIN → CEREBRO PEOPLE (remplace l'import CSV manuel).
// Fonction d'ARRIÈRE-PLAN. Déclenchée (a) chaque lundi par cerebro-linkedin-weekly.js pour tous les utilisateurs connectés,
// (b) à la demande par le bouton « Synchroniser maintenant » ou juste après la connexion (via cerebro-linkedin.js).
//
// Source : API OFFICIELLE de portabilité des données de LinkedIn (« Member Data Portability API », domaine CONNECTIONS), avec le
// consentement du membre, réservée aux membres de l'UE/EEE et de la Suisse. AUCUNE extraction de pages, aucun mot de passe LinkedIn.
// On ne lit que le nom, le poste et l'entreprise de chaque relation. Les données sont fusionnées dans l'espace PRIVÉ de l'utilisateur
// (cerebro_user_store, clé humetria:radar:contacts), avec la MÊME règle que l'import CSV de la page : clé « nom|entreprise »,
// jamais de suppression. Écriture « compare-and-set » : une modification simultanée par l'utilisateur n'est jamais écrasée.
// Le jeton d'accès est stocké CHIFFRÉ (AES-256-GCM) dans cerebro_linkedin, lisible par la seule clé de service.
//
// Variables d'environnement (Netlify) :
//   nouvelles : LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET  (application LinkedIn, voir la procédure)
//   existantes : SUPABASE_SERVICE_ROLE_KEY, CEREBRO_WATCH_SECRET (secret partagé + clé de chiffrement par défaut),
//                BREVO_API_KEY, MAIL_FROM (e-mail « autorisation expirée »)
//   optionnelle : LINKEDIN_TOKEN_KEY (clé de chiffrement dédiée ; sinon CEREBRO_WATCH_SECRET)

const crypto = require('crypto');
const K_CONTACTS = 'humetria:radar:contacts';
const COUNT = 100, MAX_PAGES = 200;

function cfg() {
  return {
    SUPABASE_URL: process.env.SUPABASE_URL || 'https://omftqlvkmjlxoinruayr.supabase.co',
    PUB: process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_RgKYatx7zHx_SJvrvoyt2w_fXhLKQ1w',
    SERVICE: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SECRET: process.env.CEREBRO_WATCH_SECRET || '',
    TOKEN_KEY: process.env.LINKEDIN_TOKEN_KEY || process.env.CEREBRO_WATCH_SECRET || '',
    LI_ID: process.env.LINKEDIN_CLIENT_ID || '', LI_SECRET: process.env.LINKEDIN_CLIENT_SECRET || '',
    BREVO: process.env.BREVO_API_KEY || process.env.BREVO_KEY || process.env.SENDINBLUE_API_KEY,
    FROM: process.env.CEREBRO_ALERT_FROM || process.env.MAIL_FROM || '',
    SITE: process.env.URL || 'https://kwcockpit.netlify.app',
  };
}
const lc = s => String(s == null ? '' : s).toLowerCase();
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fail = (kind, msg) => { const e = new Error(msg || kind); e.kind = kind; return e; };

// ── Chiffrement du jeton (AES-256-GCM) ──
const aesKey = C => crypto.createHash('sha256').update(String(C.TOKEN_KEY)).digest();
function encrypt(C, plain) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', aesKey(C), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}
function decrypt(C, s) {
  try {
    const [v, iv, tag, enc] = String(s).split(':'); if (v !== 'v1') return null;
    const d = crypto.createDecipheriv('aes-256-gcm', aesKey(C), Buffer.from(iv, 'base64')); d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
  } catch (_) { return null; }
}

// ── Lecture des relations (tolérante au format exact : noms de champs et enveloppe) ──
function extractRows(j) {
  const out = [];
  for (const el of ((j && j.elements) || [])) {
    if (el && Array.isArray(el.snapshotData)) out.push(...el.snapshotData);
    else if (el && typeof el === 'object' && (el['First Name'] || el.Position || el.firstName || el.name || el.Name)) out.push(el);
  }
  return out;
}
const norm = k => String(k).toLowerCase().replace(/[^a-z]/g, '');
function pick(row, ...names) { for (const n of names) for (const k of Object.keys(row)) if (norm(k) === n) return String(row[k] == null ? '' : row[k]).trim(); return ''; }
function toContact(row) {
  if (!row || typeof row !== 'object') return null;
  const name = pick(row, 'fullname', 'name') || [pick(row, 'firstname'), pick(row, 'lastname')].filter(Boolean).join(' ');
  if (!name) return null;
  return { name, position: pick(row, 'position', 'jobtitle', 'title'), company: pick(row, 'company', 'companyname', 'organization') };
}
async function fetchConnections(doFetch, token) {
  // Pagination SÛRE : LinkedIn avertit que le total renvoyé n'est pas fiable (certaines données sont assemblées hors ligne) et qu'un
  // arrêt fondé sur lui, ou sur « moins de lignes que demandé », tronque l'export en silence. On avance donc du nombre de lignes
  // RÉELLEMENT reçues et on ne s'arrête que sur une page vide, une page déjà vue ou la fin des données (404).
  const rows = [], seen = new Set(); let start = 0, prevFirst = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await doFetch('https://api.linkedin.com/rest/memberSnapshotData?q=criteria&domain=CONNECTIONS&start=' + start + '&count=' + COUNT, {
      headers: { Authorization: 'Bearer ' + token, 'LinkedIn-Version': '202312', 'X-Restli-Protocol-Version': '2.0.0' } });
    if (r.status === 404) { if (page === 0) throw fail('nodata', 'LinkedIn répond « 404 No data found » : l’instantané de vos relations n’est pas encore préparé (comptez une vingtaine de minutes après la connexion)'); break; }
    if (r.status === 401) throw fail('expired', 'autorisation LinkedIn expirée ou révoquée (401)');
    if (r.status === 403) throw fail('forbidden', 'LinkedIn refuse l’accès (403) : profil hors UE/EEE/Suisse, ou produit « Member Data Portability API (Member) » non activé sur l’application LinkedIn');
    if (r.status === 429) throw fail('rate', 'limite de requêtes LinkedIn atteinte (429) : nouvel essai au prochain passage');
    if (!r.ok) throw fail('http', 'LinkedIn HTTP ' + r.status);
    const got = extractRows(await r.json());
    if (!got.length) break;                                         // page vide : fin des données
    const first = JSON.stringify(got[0]);
    if (page > 0 && first === prevFirst) break;                     // l'API ne pagine pas : mêmes lignes renvoyées
    let added = 0;
    for (const g of got) { const k = JSON.stringify(g); if (!seen.has(k)) { seen.add(k); rows.push(g); added++; } }
    if (!added) break;
    prevFirst = first; start += got.length;                         // on avance du nombre de lignes reçues, jamais d'un pas supposé
  }
  return rows;
}

// ── Fusion dans l'espace privé (même règle que l'import CSV de la page) ──
async function mergeContacts(sb, userId, incoming) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await sb.from('cerebro_user_store').select('value,updated_at').eq('user_id', userId).eq('key', K_CONTACTS).maybeSingle();
    if (r && r.error) throw new Error('lecture contacts : ' + r.error.message);
    const row = r && r.data, cur = row && Array.isArray(row.value) ? row.value : [];
    const map = new Map(cur.map(c => [lc(c.name + '|' + c.company), c]));
    for (const c of incoming) { const k = lc(c.name + '|' + c.company); map.set(k, Object.assign({}, map.get(k) || {}, c)); }   // fusion : l'URL du profil (issue d'un CSV) n'est pas perdue
    const merged = [...map.values()];
    const added = merged.length - cur.length;
    if (JSON.stringify(merged) === JSON.stringify(cur)) return { added: 0, total: cur.length, written: false };
    let ok;
    if (row && row.updated_at) {
      const w = await sb.from('cerebro_user_store').update({ value: merged }).eq('user_id', userId).eq('key', K_CONTACTS).eq('updated_at', row.updated_at).select('key');
      if (w.error) throw new Error('écriture contacts : ' + w.error.message);
      ok = !!(w.data && w.data.length);
    } else {
      const w = await sb.from('cerebro_user_store').insert({ user_id: userId, key: K_CONTACTS, value: merged });
      ok = !w.error;
    }
    if (ok) return { added, total: merged.length, written: true };
    await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
  }
  throw new Error('conflit d’écriture persistant sur les contacts (4 essais) : rien n’a été modifié');
}

async function sendMail(C, doFetch, to, subject, html) {
  if (!C.BREVO || !C.FROM || !to) return 'non envoyé : Brevo non configuré';
  try {
    const r = await doFetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': C.BREVO, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: { email: C.FROM, name: 'Cerebro · Kaizen Way' }, to: [{ email: to }], subject, htmlContent: html }) });
    return r.status === 201 ? 'envoyé' : 'échec Brevo : HTTP ' + r.status;
  } catch (e) { return 'échec Brevo : ' + ((e && e.message) || 'réseau'); }
}

// ── Synchronisation d'UN utilisateur ──
async function syncUser(C, sb, doFetch, userId) {
  const r = await sb.from('cerebro_linkedin').select('*').eq('user_id', userId).maybeSingle();
  const row = r && r.data; if (!row) return { status: 'absent' };
  const now = new Date().toISOString();
  const patch = async (fields) => { await sb.from('cerebro_linkedin').update({ ...fields, last_sync_at: now, updated_at: now }).eq('user_id', userId); };
  const expired = async (why) => {
    await patch({ last_status: 'expired', last_error: why });
    let note = 'déjà notifiée';
    if (!row.expired_notified) {
      let email = null; try { const u = await sb.auth.admin.getUserById(userId); email = u && u.data && u.data.user && u.data.user.email; } catch (_) {}
      note = await sendMail(C, doFetch, email, 'Cerebro People — votre autorisation LinkedIn a expiré',
        `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:640px"><p>L’autorisation LinkedIn de <b>Cerebro People</b> a expiré ou a été révoquée : vos relations ne sont plus synchronisées.</p>
        <p>Pour la renouveler (30 secondes) : Cockpit → Cerebro → People → <b>Reconnecter LinkedIn</b> (<a href="${esc(C.SITE)}">${esc(C.SITE.replace(/^https?:\/\//, ''))}</a>).</p>
        <p style="color:#777">Contacts déjà synchronisés : conservés. Cause : ${esc(why)}</p></div>`);
      await sb.from('cerebro_linkedin').update({ expired_notified: true }).eq('user_id', userId);
    }
    return { status: 'expired', error: why, mail: note };
  };
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return expired('autorisation arrivée à échéance');
  const token = decrypt(C, row.access_token);
  if (!token) return expired('jeton illisible (clé de chiffrement modifiée ?)');
  try {
    const contacts = (await fetchConnections(doFetch, token)).map(toContact).filter(Boolean);
    if (!contacts.length) { await patch({ last_status: 'pending', last_error: null }); return { status: 'pending' }; }   // instantané LinkedIn pas encore prêt : on ne touche à rien
    const m = await mergeContacts(sb, userId, contacts);
    await patch({ last_status: 'ok', last_error: null, last_count: contacts.length, expired_notified: false });
    return { status: 'ok', read: contacts.length, added: m.added, total: m.total, written: m.written };
  } catch (e) {
    if (e && e.kind === 'expired') return expired(e.message);
    if (e && e.kind === 'nodata') {
      const old = row.connected_at && Date.now() - new Date(row.connected_at).getTime() > 3 * 864e5;
      if (!old) { await patch({ last_status: 'pending', last_error: e.message }); return { status: 'pending', note: e.message }; }
      await patch({ last_status: 'error', last_error: 'LinkedIn répond toujours « 404 No data found » plus de 3 jours après la connexion : reconnectez LinkedIn, ou vérifiez que l’application a bien le produit « Member Data Portability API (Member) »' });
      return { status: 'error', error: 'toujours aucune donnée après 3 jours' };
    }
    await patch({ last_status: 'error', last_error: (e && e.message) || 'erreur' });
    return { status: 'error', error: (e && e.message) || 'erreur' };
  }
}

async function authorize(C, sb, event, body) {
  const h = event.headers || {};
  const secret = h['x-cerebro-secret'] || h['X-Cerebro-Secret'];
  if (C.SECRET && secret && secret === C.SECRET) return { mode: 'planifiée', userId: body.user_id || null };
  const token = String(h.authorization || h.Authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try { const u = await sb.auth.getUser(token); return u && u.data && u.data.user ? { mode: 'manuelle', userId: u.data.user.id } : null; } catch (_) { return null; }
}

exports.handler = async (event, context, deps) => {
  deps = deps || {};
  const C = cfg(), doFetch = deps.fetch || fetch;
  if (!event || event.httpMethod !== 'POST' || !C.SERVICE) return { statusCode: 400 };
  const sb = (deps.createClient || require('@supabase/supabase-js').createClient)(C.SUPABASE_URL, C.SERVICE, { auth: { persistSession: false } });
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const who = await authorize(C, sb, event, body); if (!who) return { statusCode: 401 };
  let ids = [];
  if (who.userId) ids = [who.userId];
  else {
    const now = deps.now ? deps.now() : new Date();
    const r = await sb.from('cerebro_linkedin').select('user_id,last_status');
    // Tâche quotidienne : le lundi, tout le monde (synchronisation hebdomadaire) ; les autres jours, seulement les connexions dont
    // la dernière synchronisation est « en attente » (LinkedIn prépare les données) ou « en erreur » : nouvel essai rapide.
    ids = ((r && r.data) || []).filter(x => body.force === true || now.getUTCDay() === 1 || x.last_status === 'pending' || x.last_status === 'error' || !x.last_status).map(x => x.user_id);
  }
  const results = {};
  for (const id of ids) { try { results[id] = await syncUser(C, sb, doFetch, id); } catch (e) { results[id] = { status: 'error', error: (e && e.message) || 'erreur' }; } }
  console.log('[cerebro-linkedin-sync]', who.mode, ids.length + ' utilisateur(s)', JSON.stringify(Object.values(results).map(r => r.status)));
  return { statusCode: 202, body: JSON.stringify({ results }) };
};
exports._lib = { cfg, encrypt, decrypt, extractRows, toContact, fetchConnections, mergeContacts, syncUser };
