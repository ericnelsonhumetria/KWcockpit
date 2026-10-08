// netlify/functions/cerebro-watch-background.js  (v1)
// VEILLE CEREBRO CÔTÉ SERVEUR — tourne en arrière-plan (jusqu'à 15 min), sans navigateur ouvert.
// Déclenchée (a) chaque lundi par cerebro-watch.js (tâche planifiée), ou (b) à la demande depuis la page
// (bouton « Veille complète »), par un utilisateur qui a accès à Cerebro Business.
//
// Pipeline :
//  1. Sources structurées : France Travail (offres d'encadrement de proximité des 30 derniers jours,
//     agrégées par entreprise → signal « recrutement en volume », daté et sourcé, sans IA).
//  2. 4 agents capteurs IA (même logique que la page) + fusion par entreprise.
//  3. Indice INSEE (API Recherche d'entreprises, gratuite) : établissements ouverts, en minimum « ≥ N ».
//  4. Consolidation IA par lots de 4 : fit ICP, multi-sites, besoin, signaux complémentaires,
//     interlocuteur lié au signal.
//  5. Score (identique à la page), dépôt dans la « boîte de réception » Supabase
//     (clé humetria:radar:inbox) que la page fusionne à l'ouverture, journal des veilles,
//     alerte email Brevo pour chaque compte qui passe en FRAPPER.
//
// ⚠ Prompts et règles de score DUPLIQUÉS depuis cerebro/index.html : toute modification
//   de l'un doit être reportée dans l'autre (repère : « SYNC-PAGE »).
//
// Variables d'environnement (Netlify) :
//   existantes : SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, CEREBRO_MODEL, CEREBRO_WEB_SEARCH
//   nouvelles  : CEREBRO_WATCH_SECRET   (obligatoire : secret partagé avec cerebro-watch.js)
//                FRANCE_TRAVAIL_CLIENT_ID, FRANCE_TRAVAIL_CLIENT_SECRET   (optionnelles : sans elles,
//                l'étape France Travail est sautée et signalée dans le journal)
//                BREVO_API_KEY, CEREBRO_ALERT_TO (emails séparés par des virgules),
//                CEREBRO_ALERT_FROM (expéditeur vérifié dans Brevo)   (optionnelles : sans elles, pas d'email)

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL  = process.env.SUPABASE_URL || 'https://omftqlvkmjlxoinruayr.supabase.co';
const SUPABASE_PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_RgKYatx7zHx_SJvrvoyt2w_fXhLKQ1w';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL         = process.env.CEREBRO_MODEL || 'claude-sonnet-5';
const WEB_SEARCH_ON = (process.env.CEREBRO_WEB_SEARCH || '').toLowerCase() === 'on';
const WATCH_SECRET  = process.env.CEREBRO_WATCH_SECRET || '';
const FT_ID = process.env.FRANCE_TRAVAIL_CLIENT_ID, FT_SECRET = process.env.FRANCE_TRAVAIL_CLIENT_SECRET;
const BREVO_KEY = process.env.BREVO_API_KEY, ALERT_TO = process.env.CEREBRO_ALERT_TO || '', ALERT_FROM = process.env.CEREBRO_ALERT_FROM || '';

const K = { siglib: 'humetria:radar:siglib', icp: 'humetria:radar:icp', known: 'humetria:radar:known', accounts: 'humetria:radar:accounts',
            feedback: 'humetria:radar:feedback', signals: 'humetria:radar:signals', inbox: 'humetria:radar:inbox', log: 'humetria:radar:watchlog' };
const MAX_PROSPECTS = 16;          // entreprises consolidées par veille (4 lots de 4)
const FT_DAYS = 30;                // fenêtre France Travail
const FT_MIN_OFFERS = 3;           // seuil : au moins 3 offres d'encadrement…
const FT_MIN_SITES = 2;            // …ou au moins 2 communes différentes

// ── Référentiels par défaut (SYNC-PAGE : DEFAULT_SIGLIB, DEFAULT_ICP, DEFAULT_KNOWN) ──
const SIGNAL_FAMILIES = [
  { key: 'rh', label: 'RH & encadrement' }, { key: 'direction', label: 'Direction' },
  { key: 'strategie', label: 'Stratégie & structure' }, { key: 'operations', label: 'Opérations & risques' },
];
const DEFAULT_SIGLIB = [
  { id: 'recrut_managers', family: 'rh', name: 'Recrutement en volume de managers de proximité', weight: 30, hint: "plusieurs offres simultanées chef d'équipe / superviseur / responsable d'atelier / chef de quart, sur un ou plusieurs sites" },
  { id: 'turnover_encadrement', family: 'rh', name: "Turnover d'encadrement", weight: 22, hint: "mêmes postes d'encadrement republiés, départs de directeurs de site, avis salariés dégradés sur le management" },
  { id: 'nomination', family: 'direction', name: 'Nouveau dirigeant ops / RH', weight: 26, hint: 'nomination < 12 mois : DG, directeur industriel / des opérations / excellence op., DRH groupe' },
  { id: 'fonction_eo', family: 'direction', name: "Création d'une fonction excellence op. / transformation", weight: 20, hint: "création d'un poste ou d'une direction excellence opérationnelle, lean, transformation, performance industrielle" },
  { id: 'm_and_a', family: 'strategie', name: 'Acquisition / intégration de sites', weight: 24, hint: "rachat, fusion, intégration post-acquisition, entrée d'un fonds (LBO)" },
  { id: 'site_ouverture', family: 'strategie', name: 'Ouverture / extension de site', weight: 20, hint: 'nouvelle usine, extension, investissement capacitaire, lauréat France 2030' },
  { id: 'reorg', family: 'strategie', name: 'Réorganisation / plan de transformation', weight: 22, hint: 'plan de compétitivité, PSE, réorganisation, programme de transformation annoncé' },
  { id: 'marges', family: 'strategie', name: 'Pression sur les marges', weight: 12, hint: "avertissement sur résultats, baisse de marge, plan d'économies" },
  { id: 'incident', family: 'operations', name: 'Incidents sécurité / qualité / social', weight: 18, hint: 'accident grave, rappel produit, mise en demeure ICPE, grève ou conflit social sur site' },
  { id: 'programme_ci', family: 'operations', name: 'Lancement programme lean / amélioration continue', weight: 20, hint: "offres responsable amélioration continue / lean, déploiement d'un système de management de la performance, prise de parole dirigeant" },
];
const DEFAULT_ICP = [
  { name: 'Multi-site industriel', weight: 22, note: 'Plusieurs sites de production (idéalement 5+)' },
  { name: 'Masse critique de managers terrain', weight: 20, note: '≥ 50–100 managers de proximité mesurables' },
  { name: 'Secteur à culture excellence op.', weight: 16, note: 'Agro, cosmétique, pharma, chimie, auto, aéro, matériaux' },
  { name: 'Taille du groupe', weight: 12, note: 'ETI / grand groupe, CA élevé' },
  { name: 'Signaux déclencheurs', weight: 18, note: 'Fonction excellence op./performance, lean/CI, restructuration, enjeux qualité/sécurité' },
  { name: 'Empreinte FR / francophone', weight: 12, note: "France d'abord, puis multinationale à ancrage FR" },
];
const DEFAULT_KNOWN = ["L'Oréal", 'Michelin', 'Andros', 'Pierre Fabre', 'Havea', 'Saipol', 'Avril', 'SOCOTEC', 'LVMH', 'Carrefour', 'Siemens', 'Teisseire', 'Carlsberg'];
// Mots-clés France Travail : postes d'encadrement de proximité en production / logistique industrielle
const FT_KEYWORDS = ["chef d'équipe production", 'superviseur production', "responsable d'atelier", 'chef de quart', 'team leader production', 'manager de proximité', 'responsable de ligne', 'chef de secteur production'];

// ── Scoring (SYNC-PAGE : normCo, recency, signalScoreOf, priorityOf) ──
const clamp = n => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
const normCo = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(groupe|group|sa|sas|se|ag|gmbh|holding)\b/g, '').replace(/[^a-z0-9]/g, '');
const libIndex = lib => Object.fromEntries(lib.map(s => [s.id, s]));
function recency(dateStr) {
  const t = Date.parse(dateStr || '');
  if (!dateStr || isNaN(t)) return 0.3;
  const d = (Date.now() - t) / 86400000;
  if (d < -31) return 0.3;
  return d <= 92 ? 1 : d <= 183 ? 0.7 : d <= 366 ? 0.4 : 0.15;
}
function signalScoreOf(signals, libMap) {
  const best = {};
  for (const s of signals || []) {
    const w = Number(libMap[s.type] && libMap[s.type].weight) || 0;
    best[s.type] = Math.max(best[s.type] || 0, w * recency(s.date) * (s.url ? 1 : 0.5));
  }
  const sum = Object.values(best).reduce((a, b) => a + b, 0);
  return clamp(100 * (1 - Math.exp(-sum / 35)));
}
const priorityOf = (p, libMap) => Math.round(0.6 * signalScoreOf(p.signals, libMap) + 0.4 * (p.fit == null ? 50 : p.fit));
function cleanSignal(s, libMap, via) {
  if (!s || !libMap[s.type]) return null;
  const fact = String(s.fact || '').trim(); if (!fact) return null;
  const out = { type: s.type, fact, date: String(s.date || ''), site: String(s.site || ''), url: /^https?:\/\//.test(s.url || '') ? s.url : '' };
  if (via) out.via = via;
  return out;
}
function addSignal(list, s) {
  if (!s) return list;
  if (list.some(x => x.type === s.type && x.fact.slice(0, 40) === s.fact.slice(0, 40))) return list;
  list.push(s); return list;
}
function parseArray(text) {
  let t = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const s = t.indexOf('['), e = t.lastIndexOf(']');
  if (s >= 0 && e > s) { try { const a = JSON.parse(t.slice(s, e + 1)); if (Array.isArray(a)) return a; } catch (_) {} }
  const objs = []; let depth = 0, start = -1;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '{') { if (depth === 0) start = i; depth++; }
    else if (t[i] === '}') { depth--; if (depth === 0 && start >= 0) { try { objs.push(JSON.parse(t.slice(start, i + 1))); } catch (_) {} start = -1; } }
  }
  if (!objs.length) throw new Error('aucune fiche exploitable');
  return objs;
}

// ── Prompts (SYNC-PAGE : sensorPrompt, consolidatorPrompt) ──
const gridText = icp => icp.map(c => `- ${c.name} (poids ${c.weight}) : ${c.note}`).join('\n');
function sensorPrompt(family, siglib, excludeList) {
  const types = siglib.filter(s => s.family === family.key && Number(s.weight) > 0);
  const today = new Date().toISOString().slice(0, 10);
  return `Tu es un agent CAPTEUR de signaux faibles pour Kaizen Way (cabinet de transformation industrielle, Go Gemba®) et Humetria (mesure des comportements managériaux, ICM® r=0.83). Famille surveillée : ${family.label}.

MISSION : via la recherche web, trouver des ÉVÉNEMENTS RÉCENTS (moins de 12 mois ; nous sommes le ${today}) chez des entreprises industrielles MULTI-SITES (au moins 3 sites de production ou d'exploitation avec de l'encadrement terrain), françaises ou à fort ancrage en France / pays francophones, qui laissent prévoir un BESOIN D'ACCOMPAGNEMENT MANAGÉRIAL de leurs équipes terrain.

TYPES DE SIGNAUX À CHASSER (utilise l'id EXACT dans "type") :
${types.map(t => `- ${t.id} — ${t.name} : ${t.hint}`).join('\n')}

MÉTHODE : multiplie les requêtes (presse économique et régionale, communiqués, offres d'emploi, nominations). Pars des événements, pas d'une liste de groupes connus. Varie secteurs et régions.

RÈGLES ABSOLUES :
- Chaque signal = UN fait précis, daté, rattaché à UNE entreprise réelle.
- "url" = une URL réellement présente dans tes résultats de recherche, sinon "". N'invente JAMAIS d'URL, de date, de fait ni d'entreprise.
- "date" au format AAAA-MM-JJ ou AAAA-MM ; "" si inconnue.
- Mieux vaut 3 signaux sûrs que 8 douteux. Écarte les mono-sites et les sociétés de services sans plancher industriel.
${excludeList.length ? '- À EXCLURE : ' + excludeList.join(', ') + '.' : ''}

Réponds UNIQUEMENT avec un tableau JSON valide (8 éléments max), sans texte ni Markdown autour :
[{"company":"nom","type":"id exact","fact":"≤20 mots, factuel","date":"AAAA-MM-JJ","site":"site ou région concerné, ou ''","url":"https://… ou ''"}]`;
}
function consolidatorPrompt(siglib, icp) {
  return `Tu es l'agent CONSOLIDATEUR de Cerebro (Kaizen Way × Humetria). Tu reçois des entreprises accompagnées de signaux faibles captés par d'autres agents. Pour CHACUNE, vérifie via la recherche web sa structure multi-sites, estime son FIT et formule l'hypothèse de besoin managérial.

FIT (0-100) selon la grille ICP :
${gridText(icp)}

- multisite = true si au moins 3 sites de production / d'exploitation avec encadrement terrain ; false si mono-site, holding sans plancher industriel ou services purs ; null si incertain.
- need = le besoin d'accompagnement managérial que CES signaux suggèrent, ≤ 20 mots, formulé comme une HYPOTHÈSE reliée aux signaux (ex. « intégrer les chefs d'équipe recrutés sur 3 sites sans culture managériale commune »).
- offer = "KW" si le besoin est d'abord d'accompagner / former les managers (séminaires, Go Gemba®, coaching) ; "Humetria" s'il est d'abord de mesurer et piloter les comportements managériaux à l'échelle multi-sites (ICM®) ; "KW+Humetria" si les deux.
- extra_signals = les AUTRES signaux faibles (moins de 12 mois) que tes recherches sur CETTE entreprise font apparaître, parmi ces types (id EXACT dans "type") :
${siglib.filter(s => Number(s.weight) > 0).map(t => `  ${t.id} — ${t.name}`).join('\n')}
  Mêmes règles que pour les capteurs : un fait précis, daté (AAAA-MM-JJ ou AAAA-MM), "url" réellement présente dans tes résultats sinon "". Ne répète pas les signaux fournis. [] si rien de fiable.
- signal_person = la personne NOMMÉE PUBLIQUEMENT dans une source liée à un signal (ex. le directeur industriel dont la nomination est annoncée, le DRH qui porte le plan de recrutement) : {"name","title","url"} avec l'URL de la source. null si aucune personne n'est nommée dans une source publique. N'invente JAMAIS un nom. Aucune coordonnée personnelle.
- N'invente rien : "n/d" si inconnu. Reprends le nom d'entreprise EXACTEMENT comme fourni.

Réponds UNIQUEMENT avec un tableau JSON valide, un objet par entreprise reçue, sans texte ni Markdown autour :
[{"company":"nom exact fourni","multisite":true,"sites":"~N ou n/d","sector":"court","region":"court","fit":<0-100>,"need":"hypothèse ≤20 mots","offer":"KW | Humetria | KW+Humetria","entry_persona":"titre du point d'entrée","extra_signals":[{"type":"id exact","fact":"≤20 mots","date":"AAAA-MM-JJ","url":"https://… ou ''"}],"signal_person":{"name":"Prénom Nom","title":"poste","url":"https://…"}}]`;
}

// ── Anthropic (mêmes règles que cerebro-claude-background.js v2) ──
async function callClaude(system, user, opts) {
  opts = opts || {};
  const payload = { model: MODEL, max_tokens: 12000, system, messages: [{ role: 'user', content: user }] };
  if (WEB_SEARCH_ON) payload.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: opts.maxUses || 5, user_location: { type: 'approximate', country: 'FR' } }];
  else { payload.thinking = { type: 'disabled' }; payload.max_tokens = 4096; }
  let data = null, searches = 0;
  for (let turn = 0; turn <= 4; turn++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload),
    });
    const txt = await r.text();
    if (!r.ok) { let m = 'API ' + r.status; try { const j = JSON.parse(txt); if (j.error && j.error.message) m += ' : ' + j.error.message; } catch (_) {} throw new Error(m); }
    data = JSON.parse(txt);
    searches += (data.usage && data.usage.server_tool_use && data.usage.server_tool_use.web_search_requests) || 0;
    if (data.stop_reason !== 'pause_turn') break;
    payload.messages = payload.messages.concat([{ role: 'assistant', content: data.content }]);
  }
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  if (!text) throw new Error(data.stop_reason === 'max_tokens' ? 'réponse coupée (max_tokens)' : 'réponse sans texte (' + data.stop_reason + ')');
  if (opts.requireSearch && !searches) throw new Error('aucune recherche web effectuée');
  return text;
}

// ── France Travail : offres d'encadrement de proximité → signal « recrutement en volume » ──
async function ftToken() {
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: FT_ID, client_secret: FT_SECRET, scope: 'api_offresdemploiv2 o2dsoffre' });
  const r = await fetch('https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  if (!r.ok) throw new Error('France Travail auth ' + r.status);
  const j = await r.json();
  if (!j.access_token) throw new Error('France Travail : jeton absent');
  return j.access_token;
}
async function ftSearch(token, motsCles, minDate, maxDate) {
  const out = [];
  for (let start = 0; start <= 1000; start += 150) {
    const qs = new URLSearchParams({ motsCles, minCreationDate: minDate, maxCreationDate: maxDate, range: `${start}-${start + 149}` });
    const r = await fetch('https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search?' + qs, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
    if (r.status === 204) break;                       // aucun résultat
    if (!r.ok && r.status !== 206) throw new Error('France Travail recherche ' + r.status);
    const j = await r.json();
    const res = Array.isArray(j.resultats) ? j.resultats : [];
    out.push(...res);
    if (res.length < 150) break;
    await new Promise(res2 => setTimeout(res2, 150));   // < 10 appels / s
  }
  return out;
}
// Agrège les offres par entreprise (nom renseigné) ; pur, testable.
function ftAggregate(offers, libMap) {
  const by = new Map(), seen = new Set();
  for (const o of offers) {
    if (!o || seen.has(o.id)) continue; seen.add(o.id);
    const name = o.entreprise && String(o.entreprise.nom || '').trim();
    if (!name) continue;                                // offre anonyme : inexploitable
    const k = normCo(name); if (!k) continue;
    if (!by.has(k)) by.set(k, { company: name, offers: [], lieux: new Set() });
    const e = by.get(k);
    e.offers.push(o);
    const lieu = o.lieuTravail || {};
    const where = String(lieu.libelle || lieu.commune || '').trim();
    if (where) e.lieux.add(where);
  }
  const signals = [];
  for (const e of by.values()) {
    if (e.offers.length < FT_MIN_OFFERS && e.lieux.size < FT_MIN_SITES) continue;
    const latest = e.offers.slice().sort((a, b) => String(b.dateCreation || '').localeCompare(String(a.dateCreation || '')))[0];
    const s = cleanSignal({
      company: e.company, type: 'recrut_managers',
      fact: `${e.offers.length} offre(s) d'encadrement de proximité en ${FT_DAYS} j sur ${Math.max(1, e.lieux.size)} site(s) — France Travail`,
      date: String(latest.dateCreation || '').slice(0, 10),
      site: [...e.lieux].slice(0, 3).join(', '),
      url: (latest.origineOffre && latest.origineOffre.urlOrigine) || ('https://candidat.francetravail.fr/offres/recherche/detail/' + latest.id),
    }, libMap, 'france_travail');
    if (s) signals.push({ company: e.company, ...s });
  }
  return signals;
}
async function ftScan(libMap, log) {
  if (!FT_ID || !FT_SECRET) { log.push('France Travail : identifiants absents, étape sautée'); return []; }
  const token = await ftToken();
  const max = new Date(), min = new Date(Date.now() - FT_DAYS * 864e5);
  const iso = d => d.toISOString().slice(0, 19) + 'Z';
  const all = [];
  for (const kw of FT_KEYWORDS) {
    try { all.push(...await ftSearch(token, kw, iso(min), iso(max))); }
    catch (e) { log.push(`France Travail « ${kw} » : ${e.message}`); }
  }
  const sig = ftAggregate(all, libMap);
  log.push(`France Travail : ${all.length} offres lues, ${sig.length} entreprise(s) au-dessus du seuil`);
  return sig;
}

// ── INSEE (API Recherche d'entreprises) : indice d'établissements ouverts, en minimum ──
async function inseeSites(company) {
  try {
    const r = await fetch('https://recherche-entreprises.api.gouv.fr/search?per_page=10&q=' + encodeURIComponent(company));
    if (!r.ok) return null;
    const j = await r.json();
    const k = normCo(company);
    const hits = (j.results || []).filter(x => normCo(x.nom_complet).startsWith(k) || normCo(x.nom_complet).includes(k));
    if (!hits.length) return null;
    return Math.max(...hits.map(x => Number(x.nombre_etablissements_ouverts) || 0));
  } catch (_) { return null; }
}

// ── Supabase (clé service) ──
async function readKey(sb, key) {
  const r = await sb.from('cerebro_team_store').select('value').eq('key', key).maybeSingle();
  return r && r.data ? r.data.value : null;
}
async function writeKey(sb, key, value) {
  const r = await sb.from('cerebro_team_store').upsert({ key, value }, { onConflict: 'key' });
  if (r && r.error) throw new Error('écriture ' + key + ' : ' + r.error.message);
}

// ── Accès : secret de la tâche planifiée, ou utilisateur ayant Cerebro Business ──
async function authorize(event) {
  const h = event.headers || {};
  const secret = h['x-cerebro-secret'] || h['X-Cerebro-Secret'];
  if (WATCH_SECRET && secret && secret === WATCH_SECRET) return 'planifiée';
  const token = String(h.authorization || h.Authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/cerebro_can', {
      method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: 'cerebro_business' }),
    });
    return r.ok && (await r.json()) === true ? 'manuelle' : null;
  } catch (_) { return null; }
}

// ── Alerte Brevo ──
async function sendAlert(hot, log) {
  if (!hot.length) return;
  if (!BREVO_KEY || !ALERT_TO || !ALERT_FROM) { log.push('Alerte : Brevo non configuré, ' + hot.length + ' compte(s) FRAPPER non notifié(s)'); return; }
  const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rows = hot.map(p => `<tr><td style="padding:6px 10px"><b>${esc(p.company)}</b><br><span style="color:#777">${esc([p.sector, p.sites, p.region].filter(Boolean).join(' · '))}</span></td>
    <td style="padding:6px 10px;font-weight:bold">${p.prio}</td>
    <td style="padding:6px 10px">${esc(p.need)}${p.signal_person && p.signal_person.name ? '<br><i>Interlocuteur lié au signal : ' + esc(p.signal_person.name) + ' — ' + esc(p.signal_person.title) + '</i>' : ''}
    <ul style="margin:4px 0 0 16px;padding:0">${p.signals.slice(0, 4).map(s => `<li>${esc(s.fact)} (${esc(s.date || 'date ?')})${s.url ? ` <a href="${esc(s.url)}">source</a>` : ''}</li>`).join('')}</ul></td></tr>`).join('');
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
    <p>Cerebro a repéré <b>${hot.length} compte(s)</b> qui passent en <b>FRAPPER</b> cette semaine (signaux récents cumulés + bon fit ICP).</p>
    <table style="border-collapse:collapse" border="1" bordercolor="#ddd">${rows}</table>
    <p style="color:#777">Reconfirmez chaque fait sur sa source avant toute approche. Détail et carto des décideurs dans le Cockpit → Cerebro → Business.</p></div>`;
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST', headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ sender: { email: ALERT_FROM, name: 'Cerebro · Kaizen Way' }, to: ALERT_TO.split(',').map(e => ({ email: e.trim() })).filter(x => x.email),
      subject: `Cerebro — ${hot.length} compte(s) à contacter cette semaine`, htmlContent: html }),
  });
  log.push(r.status === 201 ? `Alerte envoyée (${hot.length} compte(s))` : 'Alerte Brevo en échec : HTTP ' + r.status);
}

// ── Pipeline ──
async function runWatch(sb, mode) {
  const t0 = Date.now(), log = [];
  const siglib = (await readKey(sb, K.siglib)) || DEFAULT_SIGLIB;
  const icp = (await readKey(sb, K.icp)) || DEFAULT_ICP;
  const known = (await readKey(sb, K.known)) || DEFAULT_KNOWN;
  const accounts = (await readKey(sb, K.accounts)) || [];
  const feedback = (await readKey(sb, K.feedback)) || [];
  const previous = (await readKey(sb, K.signals)) || [];
  const libMap = libIndex(siglib);
  const exclude = [...new Set([...known, ...accounts.map(a => a.company), ...feedback.filter(f => f.verdict === 'noise').map(f => f.company)])];
  const excl = new Set(exclude.map(normCo));

  // 1) France Travail
  let raw = [];
  try { raw.push(...await ftScan(libMap, log)); } catch (e) { log.push('France Travail : ' + e.message); }

  // 2) Capteurs IA en parallèle
  const fams = SIGNAL_FAMILIES.filter(f => siglib.some(s => s.family === f.key && Number(s.weight) > 0));
  const res = await Promise.allSettled(fams.map(f =>
    callClaude(sensorPrompt(f, siglib, exclude), 'Balaye large : groupes industriels multi-sites en France et pays francophones.', { requireSearch: true, maxUses: 5 }).then(parseArray)));
  res.forEach((r, i) => { if (r.status === 'fulfilled') raw.push(...r.value); else log.push(`Capteur ${fams[i].label} : ${r.reason && r.reason.message}`); });

  // Fusion par entreprise
  const by = new Map();
  for (const s of raw) {
    if (!s || !s.company || excl.has(normCo(s.company))) continue;
    const clean = cleanSignal(s, libMap, s.via); if (!clean) continue;
    const k = normCo(s.company); if (!k) continue;
    if (!by.has(k)) by.set(k, { company: String(s.company).trim(), signals: [] });
    addSignal(by.get(k).signals, clean);
  }
  const merged = [...by.values()].map(m => ({ ...m, s: signalScoreOf(m.signals, libMap) })).sort((a, b) => b.s - a.s).slice(0, MAX_PROSPECTS);
  log.push(`${raw.length} signaux bruts → ${by.size} entreprises, ${merged.length} consolidées`);
  if (!merged.length) return { log, prospects: [], hot: [], ms: Date.now() - t0 };

  // 3) INSEE (indice) + 4) consolidation par lots de 4
  const insee = await Promise.all(merged.map(m => inseeSites(m.company)));
  const ctxLine = m => `- ${m.company} : ${m.signals.map(s => `${libMap[s.type].name} (${s.date || 'date ?'}) — ${s.fact}`).join(' | ')}`;
  const batches = []; for (let i = 0; i < merged.length; i += 4) batches.push(merged.slice(i, i + 4));
  const fitMap = new Map();
  const cres = await Promise.allSettled(batches.map(b => callClaude(consolidatorPrompt(siglib, icp), b.map(ctxLine).join('\n'), { requireSearch: true, maxUses: 6 }).then(parseArray)));
  cres.forEach((r, i) => { if (r.status === 'fulfilled') r.value.filter(f => f && f.company).forEach(f => fitMap.set(normCo(f.company), f)); else log.push(`Consolidation lot ${i + 1} : ${r.reason && r.reason.message}`); });

  // 5) Fiches, score, comparaison avec l'existant
  const prevMap = new Map(previous.map(p => [normCo(p.company), p]));
  const prospects = [], hot = [];
  merged.forEach((m, i) => {
    const f = fitMap.get(normCo(m.company)) || {};
    if (f.multisite === false) return;
    const signals = m.signals.slice();
    (Array.isArray(f.extra_signals) ? f.extra_signals : []).forEach(x => addSignal(signals, cleanSignal({ ...x, company: m.company }, libMap, 'consolidation')));
    const sp = f.signal_person && f.signal_person.name && /^https?:\/\//.test(f.signal_person.url || '') ? { name: String(f.signal_person.name), title: String(f.signal_person.title || ''), url: f.signal_person.url } : null;
    const p = {
      company: m.company, signals, fit: f.fit == null || f.fit === '' ? null : clamp(f.fit),
      multisite: f.multisite === true ? true : null, sites: f.sites || (insee[i] ? `≥ ${insee[i]} étab. (INSEE)` : ''), insee_sites: insee[i],
      sector: f.sector || '', region: f.region || '', need: f.need || '', offer: f.offer || '', entry_persona: f.entry_persona || '',
      signal_person: sp, origin: 'veille-auto', ts: Date.now(),
    };
    p.prio = priorityOf(p, libMap);
    const old = prevMap.get(normCo(p.company));
    const wasHot = old && priorityOf({ signals: old.signals || [], fit: old.fit }, libMap) >= 65;
    if (p.prio >= 65 && !wasHot) hot.push(p);
    prospects.push(p);
  });
  return { log, prospects, hot, ms: Date.now() - t0 };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST' || !SERVICE_KEY || !ANTHROPIC_KEY) return;
  const mode = await authorize(event);
  if (!mode) return;
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const started = new Date().toISOString();
  let result;
  try { result = await runWatch(sb, mode); }
  catch (e) { result = { log: ['Veille interrompue : ' + ((e && e.message) || 'erreur')], prospects: [], hot: [], ms: 0 }; }
  try { await sendAlert(result.hot, result.log); } catch (e) { result.log.push('Alerte : ' + e.message); }
  // Boîte de réception : la page la fusionne dans la liste à l'ouverture, puis la vide.
  try {
    const inbox = (await readKey(sb, K.inbox)) || { prospects: [] };
    const map = new Map((inbox.prospects || []).map(p => [normCo(p.company), p]));
    result.prospects.forEach(p => map.set(normCo(p.company), p));
    await writeKey(sb, K.inbox, { at: started, prospects: [...map.values()] });
    const logList = (await readKey(sb, K.log)) || [];
    logList.unshift({ at: started, mode, prospects: result.prospects.length, hot: result.hot.map(p => p.company), ms: result.ms, log: result.log });
    await writeKey(sb, K.log, logList.slice(0, 12));
  } catch (e) { console.error('[cerebro-watch]', e); }
};

// Exports pour les tests
exports._test = { ftAggregate, signalScoreOf, priorityOf, libIndex, DEFAULT_SIGLIB, normCo, cleanSignal, consolidatorPrompt, sensorPrompt, runWatch, inseeSites };
