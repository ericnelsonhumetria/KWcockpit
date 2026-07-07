// netlify/functions/pdc-conseil.js
// Analyse IA du plan de charge des consultants SALARIES, cote SERVEUR.
// Objectif direction : porter l'attention sur les salaries les MOINS charges
// (capacite de delivery disponible / marge a recuperer). Calque sur humetrix.js.
//
// Entree (POST JSON) : { annee, etat, salaries:[{nom, taux_annuel, jours_charge, jours_capacite, par_mois:[{mois,taux}]}] }
// Sortie : { analyse: "<texte markdown leger>" }

const { createClient } = require('@supabase/supabase-js');

const PERSONA = `Tu es un conseiller en pilotage de cabinet de conseil, expert Lean / Go Gemba (Kaizen Way).
Tu raisonnes en dirigeant : pour un cabinet, les consultants SALARIES sont un cout fixe ; un salarie sous-charge = de la capacite de delivery disponible et de la marge non exploitee, alors qu'un salarie en surcharge = risque de retard et de qualite.
Tu es direct, concret, oriente action terrain. Tu ne recites pas les chiffres un a un : tu interpretes.`;

async function requireAuth(authHeader) {
  if (!authHeader) return { ok: false, code: 401, msg: 'Non authentifié' };
  const token = authHeader.replace('Bearer ', '').trim();
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return { ok: false, code: 401, msg: 'Token invalide' };
  return { ok: true, email: data.user.email };
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': process.env.APP_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };

  const cle = process.env.ANTHROPIC_API_KEY;
  const guard = await requireAuth(event.headers.authorization || event.headers.Authorization);
  if (!guard.ok) return { statusCode: guard.code, headers: cors, body: JSON.stringify({ error: guard.msg }) };
  if (!cle) return { statusCode: 502, headers: cors, body: JSON.stringify({ error: 'Clé API Anthropic absente côté serveur' }) };

  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch (e) {}
  const annee = body.annee || '';
  const etat = body.etat === 'realise' ? 'réalisé' : 'planifié';
  const salaries = Array.isArray(body.salaries) ? body.salaries : [];
  if (!salaries.length) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Aucun salarié à analyser' }) };

  const lignes = salaries.map(s => {
    const mois = (s.par_mois || []).map(m => `${m.mois}:${m.taux}%`).join(' ');
    return `- ${s.nom} : taux annuel ${s.taux_annuel === null ? 'n/d' : s.taux_annuel + '%'} (${s.jours_charge}/${s.jours_capacite} j) | par mois : ${mois || 'n/d'}`;
  }).join('\n');

  const userMessage = `Voici la charge (${etat}, année ${annee}) des consultants SALARIES de Kaizen Way, en taux de charge (jours engagés / jours ouvrables disponibles) :

${lignes}

Ta mission : porte l'attention de la direction sur les SALARIES LES MOINS CHARGES.
1. Cite d'abord, classés du moins chargé au plus chargé, les salariés en sous-charge (repère < 70% comme sous-charge, mais nuance selon les données).
2. Pour chacun, dis en une phrase ce que ça signifie concrètement (capacité disponible, marge non exploitée) et repère si la sous-charge est chronique (plusieurs mois) ou ponctuelle.
3. Termine par 2 à 4 recommandations d'action concrètes et priorisées (ex. staffer sur telle mission au-delà du vendu, redéployer vers de la production interne / méthodo, formation, appui commercial).

Sois concis (10-15 lignes max), en français, ton direct de dirigeant. Utilise des tirets et **gras** léger pour la lisibilité. N'invente aucun chiffre : appuie-toi uniquement sur les données ci-dessus.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': cle, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1400,
        system: PERSONA,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    if (!res.ok) {
      const errTxt = await res.text().catch(() => '');
      return { statusCode: 502, headers: cors, body: JSON.stringify({ error: `Anthropic ${res.status}`, detail: errTxt.slice(0, 300) }) };
    }
    const data = await res.json();
    const texte = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    return { statusCode: 200, headers: cors, body: JSON.stringify({ analyse: texte }) };
  } catch (e) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};
