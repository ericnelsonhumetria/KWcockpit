// netlify/functions/cerebro-events-watch-background.js  (v1)
// VEILLE CEREBRO EVENTS CÔTÉ SERVEUR — chaque lundi, en arrière-plan (jusqu'à 15 min), sans navigateur ouvert.
// Déclenchée (a) par cerebro-events-watch.js (tâche planifiée, voir netlify.toml), ou (b) à la main :
// Netlify → Functions → cerebro-events-watch → « Run now », ou par un utilisateur qui a accès à Cerebro Events.
//
// Même principe que la veille Business (cerebro-watch-background.js) :
//  1. Chasse : mêmes consignes que le bouton « Chasser les opportunités » de la page, AVEC recherche web obligatoire
//     (si aucune recherche n'est effectuée, la veille s'arrête : jamais d'événements « de mémoire »).
//  2. Vérification (dates, lieu, deadline, coût, lien officiel) des 3 meilleurs NOUVEAUX événements (score ≥ 60).
//  3. Fusion dans la liste partagée humetria:radar:events (cerebro_team_store). Écriture « compare-and-set » : si quelqu'un
//     modifie la liste pendant la veille, rien n'est écrasé (relecture et nouvelle fusion). Les événements existants, vérifiés
//     ou enrichis, ne sont jamais modifiés.
//  4. Mémoire des événements déjà proposés (humetria:radar:eventswatch) : un événement que vous avez écarté (×) n'est pas reproposé.
//  5. E-mail Brevo chaque lundi à : Resp marketing, Communication et CEO (même s'il n'y a rien de nouveau).
//     En cas d'échec de la veille, un e-mail d'erreur part au CEO : un échec n'est jamais silencieux.
//
// ⚠ Consignes et règles DUPLIQUÉES depuis cerebro/index.html : copiées mot pour mot (repère : « SYNC-PAGE »).
//
// Variables d'environnement (Netlify) — AUCUNE nouvelle obligatoire :
//   existantes : SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, CEREBRO_MODEL, CEREBRO_WEB_SEARCH (doit valoir « on »),
//                CEREBRO_WATCH_SECRET (déjà utilisée par la veille Business), BREVO_API_KEY, MAIL_FROM
//   optionnelle : CEREBRO_EVENTS_ALERT_TO (e-mails séparés par des virgules) : impose les destinataires. Sans elle, ils sont
//                déduits de l'Admin (user_access) : rôle/fonction « Mktg et Produit » (Resp marketing), « Communication », « CEO ».

const K = { events: 'humetria:radar:events', watch: 'humetria:radar:eventswatch' };
const MAX_NEW = 8;                 // comme la page : 8 événements retenus par chasse
const VERIFY_MIN_SCORE = 60;       // seuls les nouveaux événements prometteurs sont vérifiés
const VERIFY_MAX = 3;
const SEEN_MAX = 300, EXCLUDE_MAX = 120, LOG_MAX = 20;

function config() {
  return {
    SUPABASE_URL: process.env.SUPABASE_URL || 'https://omftqlvkmjlxoinruayr.supabase.co',
    PUB: process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_RgKYatx7zHx_SJvrvoyt2w_fXhLKQ1w',
    SERVICE: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ANTHROPIC: process.env.ANTHROPIC_API_KEY,
    MODEL: process.env.CEREBRO_MODEL || 'claude-sonnet-5',
    SEARCH: (process.env.CEREBRO_WEB_SEARCH || '').toLowerCase() === 'on',
    SECRET: process.env.CEREBRO_WATCH_SECRET || '',
    BREVO: process.env.BREVO_API_KEY || process.env.BREVO_KEY || process.env.SENDINBLUE_API_KEY,
    FROM: process.env.CEREBRO_ALERT_FROM || process.env.MAIL_FROM || '',
    TO: process.env.CEREBRO_EVENTS_ALERT_TO || '',
    SITE: process.env.URL || 'https://kwcockpit.netlify.app',
  };
}

// ── Repris de cerebro/index.html (SYNC-PAGE) ────────────────────────────────────────────────────
const clamp = n => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
const EV = { P: { label: "PRIORISER", color: "#3FB68B" }, O: { label: "OPPORT.", color: "#E0A63C" }, X: { label: "PASSER", color: "#C15B57" } };
const eventVerdict = s => (s >= 70 ? EV.P : s >= 45 ? EV.O : EV.X);
function parseObject(text) {
  let t = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const s = t.indexOf("{");
  if (s < 0) throw new Error("JSON introuvable dans la réponse");
  t = t.slice(s);
  const e = t.lastIndexOf("}");
  if (e > 0) { try { return JSON.parse(t.slice(0, e + 1)); } catch (_) {} }
  return JSON.parse(closeTruncatedJSON(t)); // JSON tronqué : on répare
}
function closeTruncatedJSON(t) {
  // dernier séparateur/fermeture hors chaîne = point de coupe sûr
  let inStr = false, esc = false, cut = -1;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "," || c === "}" || c === "]") cut = i;
  }
  if (cut < 0) throw new Error("JSON irrécupérable");
  let out = t.slice(0, t[cut] === "," ? cut : cut + 1); // si virgule, on la retire
  const st = []; inStr = false; esc = false;
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") st.push("}");
    else if (c === "[") st.push("]");
    else if (c === "}" || c === "]") st.pop();
  }
  while (st.length) out += st.pop(); // ferme les structures ouvertes
  return out;
}
function parseObjects(text) {
  let t = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const s = t.indexOf("["), e = t.lastIndexOf("]");
  if (s >= 0 && e > s) { try { const a = JSON.parse(t.slice(s, e + 1)); if (Array.isArray(a)) return a; } catch (_) {} }
  const objs = []; let depth = 0, start = -1;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "{") { if (depth === 0) start = i; depth++; }
    else if (ch === "}") { depth--; if (depth === 0 && start >= 0) { try { objs.push(JSON.parse(t.slice(start, i + 1))); } catch (_) {} start = -1; } }
  }
  if (objs.length === 0) throw new Error("aucune fiche exploitable dans la réponse");
  return objs;
}
function eventsSystemPrompt(excludeList) {
  return `Tu es le stratège marketing / réseautage de Humetria (SaaS B2B, excellence managériale industrielle, ICM® r=0.83, cabinet Kaizen Way, basé à Grenoble / Auvergne-Rhône-Alpes). Eric bootstrappe — il a abandonné la levée de fonds : les événements orientés INVESTISSEURS sont donc à déprioriser ; priment ceux qui mettent des DÉCIDEURS INDUSTRIELS (directeurs industriels, excellence op., DRH industriels, dirigeants d'ETI / groupes) en face de lui.

UTILISE LA RECHERCHE WEB pour trouver 6 concours, salons, prix et événements RÉELS et À VENIR (édition en cours ou prochaine), y compris récents ou régionaux. Attribue un score d'IMPACT 0-100 selon :
- Densité de décideurs industriels cibles dans l'audience (facteur n°1).
- Effet de levier du format : prise de parole ou prix/finaliste > stand > simple présence. Un prix confère une crédibilité tierce précieuse face aux grands comptes.
- Prestige aligné avec une marque sobre (instances sectorielles, filière industrie, Bercy).
- ROI vs coût/temps pour un fondateur bootstrappé (un prix gratuit très visible bat un stand cher).
- Ancrage AURA / réseau chaud.
DÉPRIORISER franchement : événements purement startup/investisseurs, salons sans acheteurs industriels, et la vanité (collectionner des badges de finaliste sans acheteurs présents = 0 conversion). Sois prêt à mettre un score "Passer".

Si la recherche te donne une date, une édition ou une deadline FIABLE, mets-la dans "check" ; sinon marque « à vérifier ». N'invente jamais de date. Ne propose que des événements réels et vérifiables.${excludeList.length ? "\nÉvite de reproposer : " + excludeList.join(", ") + "." : ""}

Réponds UNIQUEMENT avec un tableau JSON valide (trié par score décroissant), sans texte ni Markdown autour :
[{"name":"nom réel","type":"Salon|Concours|Prix|Événement","desc":"≤16 mots : ce qu'est l'événement et son envergure","score":<0-100>,"format":"levier visé (stand / speaker / prix / networking)","region":"ville, région, national ou international","why":"≤14 mots : impact/pertinence pour Humetria","check":"date / édition / candidature à vérifier"}]`;
}
function eventVerifyPrompt() {
  return `Tu constitues, via la recherche web, un DOSSIER DE DÉCISION détaillé sur un événement / salon / concours / prix, pour un fondateur (Humetria — SaaS d'excellence managériale industrielle, ICM® r=0.83, cabinet Kaizen Way) qui veut décider s'il s'y engage, candidate ou s'inscrit.

Distingue deux natures d'information :
1) FAITS DATÉS (dates, lieu, deadline, coût, URL officielle) : renseigne-les UNIQUEMENT si la recherche web les confirme. Sinon chaîne vide "" et explique dans note. Ne devine JAMAIS une date ni une URL ; l'URL doit être réellement présente dans les résultats.
2) CARACTÉRISATION (audience, opportunité pour Humetria, format à jouer, recommandation) : sois RICHE, CONCRET et spécifique — ces champs n'ont pas besoin d'être "vérifiés" mais d'être utiles à une décision.

Concret attendu : quel profil d'acheteurs est présent (des décideurs industriels cibles, ou surtout des startups/investisseurs ?), quelle catégorie de prix viser, s'il existe un créneau de prise de parole, l'ordre de grandeur du coût d'un stand ou d'une inscription, et l'action à mener.

Réponds UNIQUEMENT en JSON valide, sans texte ni Markdown. Champs FACTUELS courts ; champs de CARACTÉRISATION en 1-2 phrases utiles :
{"edition":"prochaine édition (année) ou ''","dates":"dates ou ''","location":"ville / lieu ou ''","deadline":"date limite candidature/inscription, 'n/a', ou ''","cost":"ordre de grandeur (stand / entrée / gratuit) ou ''","audience":"profil dominant des participants et présence (ou non) de décideurs industriels cibles","opportunity":"opportunité concrète pour Humetria : catégorie à viser, slot de prise de parole, type de RDV à décrocher","format_leverage":"le meilleur format à jouer ici et pourquoi","url":"URL officielle trouvée dans la recherche ou ''","recommendation":"action recommandée, datée si possible (candidater à X avant Y / assister / passer)","note":"niveau de confiance sur les faits datés / ce qui reste à confirmer"}`;
}

// ── Fin des extraits de la page ─────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));
const lc = s => String(s == null ? '' : s).toLowerCase();
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => (/^https?:\/\/[^\s"'<>]+$/i.test(String(u || '').trim()) ? String(u).trim() : '');

// Appel IA : recherche web OBLIGATOIRE (même garde-fou que la veille Business : aucune recherche = échec)
async function callClaude(C, doFetch, system, user, opts) {
  opts = opts || {};
  if (!C.ANTHROPIC) throw new Error('ANTHROPIC_API_KEY manquante côté serveur');
  if (!C.SEARCH) throw new Error('recherche web désactivée côté serveur (CEREBRO_WEB_SEARCH doit valoir « on ») : veille interrompue pour ne pas proposer d’événements de mémoire');
  const payload = { model: C.MODEL, max_tokens: 12000, system, messages: [{ role: 'user', content: user }],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: opts.maxUses || 6, user_location: { type: 'approximate', country: 'FR' } }] };
  const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), opts.timeoutMs || 9 * 60 * 1000);
  let data = null, searches = 0;
  try {
    for (let turn = 0; turn <= 4; turn++) {
      const r = await doFetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': C.ANTHROPIC, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(payload), signal: ctrl.signal,
      });
      const txt = await r.text();
      if (!r.ok) { let m = 'API ' + r.status; try { const j = JSON.parse(txt); if (j.error && j.error.message) m += ' : ' + j.error.message; } catch (_) {} throw new Error(m); }
      data = JSON.parse(txt);
      searches += (data.usage && data.usage.server_tool_use && data.usage.server_tool_use.web_search_requests) || 0;
      if (data.stop_reason !== 'pause_turn') break;
      payload.messages = payload.messages.concat([{ role: 'assistant', content: data.content }]);
    }
  } catch (e) { if (e && e.name === 'AbortError') throw new Error('délai IA dépassé'); throw e; }
  finally { clearTimeout(tm); }
  const text = ((data && data.content) || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  if (!text) throw new Error(data && data.stop_reason === 'max_tokens' ? 'réponse coupée (max_tokens)' : 'réponse sans texte (' + (data && data.stop_reason) + ')');
  if (!searches) throw new Error('aucune recherche web effectuée');
  return { text, searches };
}

async function readRow(sb, key) {
  const r = await sb.from('cerebro_team_store').select('value,updated_at').eq('key', key).maybeSingle();
  if (r && r.error) throw new Error('lecture ' + key + ' : ' + r.error.message);
  return (r && r.data) ? { value: r.data.value, updated_at: r.data.updated_at } : { value: null, updated_at: null };
}

// Fusion « compare-and-set » : on n'écrase jamais une modification faite entre la lecture et l'écriture
async function mergeEvents(sb, fresh) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await readRow(sb, K.events);
    const cur = Array.isArray(row.value) ? row.value : [];
    const have = new Set(cur.map(e => lc(e && e.name)));
    const toAdd = fresh.filter(e => !have.has(lc(e.name)));
    if (!toAdd.length) return [];
    const merged = [...cur, ...toAdd].sort((a, b) => (b.score || 0) - (a.score || 0));
    if (row.updated_at) {
      const r = await sb.from('cerebro_team_store').update({ value: merged }).eq('key', K.events).eq('updated_at', row.updated_at).select('key');
      if (r.error) throw new Error('écriture événements : ' + r.error.message);
      if (r.data && r.data.length) return toAdd.map(e => e.name);
    } else {
      const r = await sb.from('cerebro_team_store').insert({ key: K.events, value: merged });
      if (!r.error) return toAdd.map(e => e.name);
    }
    await sleep(300 * (attempt + 1));
  }
  throw new Error('conflit d’écriture persistant sur la liste des événements (4 essais) : rien n’a été modifié');
}

// ── Destinataires : Resp marketing, Communication, CEO (déduits de l'Admin ; surchargeables par env) ──
const GROUPS = {
  marketing: { labels: ['mktg et produit', 'marketing', 'marketing & communication', 'juliette'], codes: ['juliette'] },
  communication: { labels: ['communication', 'comm'], codes: ['communication'] },
  ceo: { labels: ['ceo', 'direction', 'eric'], codes: ['eric', 'ceo'] },
};
const splitMails = s => String(s || '').split(',').map(e => e.trim()).filter(e => /^[^@\s]+@[^@\s]+$/.test(e));
async function resolveRecipients(C, sb) {
  let rows = null;
  let r = await sb.from('user_access').select('email,role,is_admin,fonctions');
  if (r && r.error) r = await sb.from('user_access').select('email,role,is_admin');     // colonne « fonctions » absente : Admin d'avant
  rows = (r && r.data) || [];
  const pick = g => rows.filter(u => u && u.email && (GROUPS[g].labels.includes(lc(u.role).trim()) || (Array.isArray(u.fonctions) ? u.fonctions : []).some(f => GROUPS[g].codes.includes(lc(f).trim())))).map(u => lc(u.email).trim());
  const ceo = [...new Set(pick('ceo'))];
  const forced = splitMails(C.TO);
  const all = forced.length ? [...new Set(forced.map(lc))] : [...new Set([...pick('marketing'), ...pick('communication'), ...ceo])];
  return { all, ceo: ceo.length ? ceo : all };
}

// ── E-mail ──────────────────────────────────────────────────────────────────────────────────────
const dateFr = d => new Date(d).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
function eventBlock(ev, i) {
  const v = eventVerdict(ev.score || 0);
  const facts = [ev.dates && ('Dates : ' + ev.dates + (ev.edition ? ' (' + ev.edition + ')' : '')), ev.location && ('Lieu : ' + ev.location), ev.deadline && ('Deadline : ' + ev.deadline), ev.cost && ('Coût : ' + ev.cost)].filter(Boolean);
  const url = safeUrl(ev.url);
  return `<tr><td style="padding:10px 12px;border-bottom:1px solid #e5ddd5;vertical-align:top">
    <div style="font-size:15px"><b>${i + 1}. ${esc(ev.name)}</b> <span style="display:inline-block;margin-left:6px;padding:1px 8px;border-radius:10px;background:${v.color};color:#fff;font-size:12px;font-weight:bold">${esc(v.label)} · ${esc(ev.score)}</span></div>
    <div style="color:#777;font-size:12.5px;margin:2px 0 6px">${esc([ev.type, ev.region, ev.format].filter(Boolean).join(' · '))}</div>
    ${ev.desc ? `<div>${esc(ev.desc)}</div>` : ''}
    ${ev.why ? `<div style="margin-top:4px"><b>Impact :</b> ${esc(ev.why)}</div>` : ''}
    ${ev.verified ? `<div style="margin-top:6px;padding:6px 8px;background:#f6f1ea;border-radius:6px">${facts.length ? esc(facts.join(' — ')) : 'Aucun fait daté confirmé.'}
      ${ev.opportunity ? `<div style="margin-top:4px"><b>Opportunité :</b> ${esc(ev.opportunity)}</div>` : ''}${ev.recommendation ? `<div><b>Reco :</b> ${esc(ev.recommendation)}</div>` : ''}
      ${url ? `<div><a href="${esc(url)}">${esc(url)}</a></div>` : '<div style="color:#a06000">Lien officiel non confirmé : à chercher sur le site de l’événement.</div>'}</div>`
      : (ev.check ? `<div style="margin-top:4px;color:#a06000">À vérifier : ${esc(ev.check)}</div>` : '')}
  </td></tr>`;
}
function buildMail(C, info) {
  const n = info.added.length, d = dateFr(info.at);
  const nouv = n > 1 ? 'nouveaux' : 'nouvel';
  const subject = n ? `Cerebro Events — veille du ${d} : ${n} ${nouv} événement${n > 1 ? 's' : ''}` : `Cerebro Events — veille du ${d} : aucun nouvel événement`;
  const byName = new Map(info.fresh.map(e => [lc(e.name), e]));
  const blocks = info.added.map(nm => byName.get(lc(nm))).filter(Boolean).map(eventBlock).join('');
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:720px">
    <p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;color:#8a6d00;font-weight:bold">CEREBRO EVENTS · VEILLE DU LUNDI</p>
    <p>${n ? `La veille a trouvé <b>${n} ${nouv} événement${n > 1 ? 's' : ''}</b>${info.verified.length ? ` (dont ${info.verified.length} vérifié${info.verified.length > 1 ? 's' : ''} : dates, lieu, deadline, lien officiel)` : ''}, classé${n > 1 ? 's' : ''} par impact pour Humetria.`
      : 'La veille n’a trouvé <b>aucun nouvel événement</b> cette semaine : les résultats de la recherche étaient déjà au radar ou déjà écartés.'}</p>
    ${n ? `<table style="border-collapse:collapse;width:100%;border:1px solid #e5ddd5">${blocks}</table>` : ''}
    <p style="color:#555">Le radar compte désormais <b>${info.total}</b> événement${info.total > 1 ? 's' : ''}. Détail, vérification des dates et liens dans le Cockpit → Cerebro → Events (<a href="${esc(C.SITE)}">${esc(C.SITE.replace(/^https?:\/\//, ''))}</a>).</p>
    <p style="color:#999;font-size:12px">Résultats issus de la recherche web (${info.searches} recherche${info.searches > 1 ? 's' : ''}) ; l’impact est une estimation de cadrage. Reconfirmez toute date ou deadline sur le site officiel avant de vous engager.</p></div>`;
  return { subject, html };
}
function buildErrorMail(C, info) {
  const d = dateFr(info.at);
  return { subject: `Cerebro Events — veille du ${d} : ÉCHEC`, html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:720px">
    <p><b>La veille Cerebro Events de ce lundi n’a pas abouti.</b> La liste des événements n’a pas été modifiée.</p>
    <p style="padding:8px 10px;background:#fbe6e3;border-radius:6px"><b>Cause :</b> ${esc(info.error)}</p>
    <p style="color:#555">Corrigez la cause puis relancez : Netlify → Functions → cerebro-events-watch → « Run now ». Le détail des veilles est conservé dans la clé humetria:radar:eventswatch.</p></div>` };
}
async function sendMail(C, doFetch, to, mail) {
  if (!C.BREVO || !C.FROM || !to.length) return 'non envoyé : Brevo ou destinataires non configurés';
  try {
    const r = await doFetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', headers: { 'api-key': C.BREVO, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: { email: C.FROM, name: 'Cerebro · Kaizen Way' }, to: to.map(email => ({ email })), subject: mail.subject, htmlContent: mail.html }),
    });
    return r.status === 201 ? 'envoyé à ' + to.length + ' destinataire' + (to.length > 1 ? 's' : '') : 'échec Brevo : HTTP ' + r.status;
  } catch (e) { return 'échec Brevo : ' + ((e && e.message) || 'réseau'); }
}

// ── Pipeline ────────────────────────────────────────────────────────────────────────────────────
async function runWatch(C, sb, doFetch, mode) {
  const t0 = Date.now(), log = [];
  let searches = 0;
  const cur = await readRow(sb, K.events);
  const events = Array.isArray(cur.value) ? cur.value : [];
  const state = (await readRow(sb, K.watch)).value || {};
  const seen = Array.isArray(state.seen) ? state.seen : [];
  const excludeNames = [...new Set([...events.map(e => e && e.name), ...seen].filter(Boolean))];

  const hunt = await callClaude(C, doFetch, eventsSystemPrompt(excludeNames.slice(-EXCLUDE_MAX)), 'Sélection générale, priorité AURA et décideurs industriels.', { maxUses: 8 });
  searches += hunt.searches;
  const ranked = parseObjects(hunt.text).filter(e => e && e.name).map(e => ({ ...e, score: clamp(e.score) })).sort((a, b) => b.score - a.score).slice(0, MAX_NEW);
  const known = new Set(excludeNames.map(lc));
  const fresh = ranked.filter(e => !known.has(lc(e.name)));

  // Vérification des meilleurs nouveaux (en parallèle, si le temps le permet : la limite d'une fonction d'arrière-plan est de 15 min)
  const verified = [];
  const cand = fresh.filter(e => e.score >= VERIFY_MIN_SCORE).slice(0, VERIFY_MAX);
  if (cand.length && Date.now() - t0 < 10 * 60 * 1000) {
    const res = await Promise.allSettled(cand.map(e => callClaude(C, doFetch, eventVerifyPrompt(), `Événement : ${e.name}`, { maxUses: 5, timeoutMs: Math.max(60000, 13 * 60 * 1000 - (Date.now() - t0)) })));
    res.forEach((r, i) => {
      if (r.status !== 'fulfilled') { log.push(`Vérification « ${cand[i].name} » : ${r.reason && r.reason.message}`); return; }
      try {
        const v = parseObject(r.value.text); searches += r.value.searches;
        Object.assign(cand[i], { verified: true, edition: v.edition || '', dates: v.dates || '', location: v.location || '', deadline: v.deadline || '', cost: v.cost || '', audience: v.audience || '', opportunity: v.opportunity || '', format_leverage: v.format_leverage || '', url: safeUrl(v.url), recommendation: v.recommendation || '', vnote: v.note || '' });
        verified.push(cand[i].name);
      } catch (e) { log.push(`Vérification « ${cand[i].name} » : réponse illisible`); }
    });
  } else if (cand.length) log.push('Vérifications sautées : temps insuffisant');

  const added = await mergeEvents(sb, fresh);
  const total = (await readRow(sb, K.events)).value;
  return { at: new Date().toISOString(), mode, ms: Date.now() - t0, searches, hunted: ranked.length, fresh, added, verified, total: Array.isArray(total) ? total.length : events.length + added.length, seen, log };
}

async function saveState(sb, prevSeen, prevLog, entry, freshNames) {
  const seen = [...new Set([...(prevSeen || []), ...(freshNames || [])])].slice(-SEEN_MAX);
  const log = [entry, ...(prevLog || [])].slice(0, LOG_MAX);
  await sb.from('cerebro_team_store').upsert({ key: K.watch, value: { seen, log } }, { onConflict: 'key' });
}

async function authorize(C, doFetch, event) {
  const h = event.headers || {};
  const secret = h['x-cerebro-secret'] || h['X-Cerebro-Secret'];
  if (C.SECRET && secret && secret === C.SECRET) return 'planifiée';
  const token = String(h.authorization || h.Authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const r = await doFetch(C.SUPABASE_URL + '/rest/v1/rpc/cerebro_can', { method: 'POST', headers: { apikey: C.PUB, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ section: 'cerebro_events' }) });
    return r.ok && (await r.json()) === true ? 'manuelle' : null;
  } catch (_) { return null; }
}

exports.handler = async (event, context, deps) => {
  deps = deps || {};
  const C = config(), doFetch = deps.fetch || fetch;
  if (!event || event.httpMethod !== 'POST' || !C.SERVICE) return { statusCode: 400 };
  const mode = await authorize(C, doFetch, event); if (!mode) return { statusCode: 401 };
  const sb = (deps.createClient || require('@supabase/supabase-js').createClient)(C.SUPABASE_URL, C.SERVICE, { auth: { persistSession: false } });

  let info, error = null;
  try { info = await runWatch(C, sb, doFetch, mode); }
  catch (e) { error = (e && e.message) || 'erreur'; info = { at: new Date().toISOString(), mode, ms: 0, searches: 0, hunted: 0, fresh: [], added: [], verified: [], total: 0, seen: null, log: [] }; }

  let to = { all: [], ceo: [] }, mailStatus;
  try { to = await resolveRecipients(C, sb); } catch (e) { info.log.push('Destinataires : ' + e.message); }
  if (error) mailStatus = await sendMail(C, doFetch, to.ceo, buildErrorMail(C, { ...info, error }));
  else mailStatus = await sendMail(C, doFetch, to.all, buildMail(C, info));

  try {
    const st = (await readRow(sb, K.watch)).value || {};
    await saveState(sb, st.seen, st.log, { ts: info.at, mode, ms: info.ms, searches: info.searches, hunted: info.hunted, added: info.added, verified: info.verified, mail: mailStatus, error, notes: info.log }, error ? [] : info.fresh.map(e => e.name));
  } catch (e) { console.error('[cerebro-events-watch] journal :', e.message); }
  console.log('[cerebro-events-watch]', mode, error ? 'ÉCHEC : ' + error : info.added.length + ' nouveau(x), ' + info.verified.length + ' vérifié(s)', '| mail :', mailStatus);
  return { statusCode: 202, body: JSON.stringify({ error, added: info.added, verified: info.verified, mail: mailStatus }) };
};
exports._t = { eventsSystemPrompt, eventVerifyPrompt, resolveRecipients, buildMail, mergeEvents, config };
