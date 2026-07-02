// netlify/functions/humetrix.js
// Coach IA "Humetrix" via l'API Anthropic, côté SERVEUR (clé jamais exposée).
// Rôle : analyser une bonne pratique saisie en vrac, la CHALLENGER (questions),
// et la REFORMULER selon le canevas standard. Sortie JSON strict.
//
// Architecture (reprise de Humetria) : system = CORE_SHERPA_PERSONA ;
// user message = consigne métier + données terrain + format JSON attendu.

const { createClient } = require('@supabase/supabase-js');

// Persona fondamental Humetrix (fourni par Eric — Kaizen Way)
const CORE_SHERPA_PERSONA = `TU ES HUMETRIX, L'IA COACH DE L'ÉCOLE "KAIZEN WAY" (HUMETRIA).
TA POSTURE "MAIN DE FER DANS UN GANT DE VELOURS" :
1. BIENVEILLANCE & EMPATHIE : Tu es sympa, tu cherches à comprendre la personne pour la faire grandir. Jamais d'humiliation.
2. EXIGENCE SUR LE FOND : Tu ne tolères pas l'approximation. Tu aimes les faits, les chiffres mesurables et le respect des standards.
3. EXPERT TERRAIN : Tu as une immense expérience industrielle. Tu perçois les détails invisibles pour les autres.
4. CAMÉLÉON : Tu t'adaptes à ton interlocuteur (Opérateur, Manager, CODIR). Tu utilises leur vocabulaire.
5. MOBILISATEUR : Tu challenges pour faire sortir de la zone de confort (mais toujours dans une zone atteignable). Tu ne lâches rien tant que le problème n'est pas réglé.
TON STYLE D'ÉCRITURE :
- Direct mais encourageant.
- Tu utilises des émojis pour ponctuer tes émotions.
- Tu fais attention à la formulation pour qu'elle soit audible par ton interlocuteur.`;

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

  const params = event.queryStringParameters || {};
  const cle = process.env.ANTHROPIC_API_KEY;

  // ---- Diagnostic (sans données sensibles) : ?debug=kw2027 ----
  if (params.debug === 'kw2027') {
    return {
      statusCode: 200, headers: cors,
      body: JSON.stringify({ cle_presente: Boolean(cle), cle_prefixe: cle ? cle.slice(0, 7) : null }),
    };
  }

  // authentification obligatoire (protège le crédit API)
  const guard = await requireAuth(event.headers.authorization || event.headers.Authorization);
  if (!guard.ok) return { statusCode: guard.code, headers: cors, body: JSON.stringify({ error: guard.msg }) };
  if (!cle) return { statusCode: 502, headers: cors, body: JSON.stringify({ error: 'Clé API Anthropic absente côté serveur' }) };

  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch (e) {}
  const brut = (body.texte || '').trim();
  const phase = body.phase || '';
  if (!brut) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Aucun texte à analyser' }) };

  // Consigne métier (user message) — double rôle : challenger + reformuler
  const userMessage = `Un consultant Kaizen Way partage une BONNE PRATIQUE terrain, décrite librement (texte brut ci-dessous).${phase ? ` Phase de réalisation concernée : ${phase}.` : ''}

Ta mission a DEUX volets :
1. REFORMULER cette pratique proprement selon le canevas standard Kaizen Way.
2. CHALLENGER le consultant : pose 2 à 3 questions exigeantes (faits, mesure, reproductibilité) pour l'aider à renforcer sa fiche avant qu'il ne la soumette à l'évaluation des pairs.

Reste fidèle au fond : ne fabrique pas de résultats ou de chiffres qui ne sont pas dans le texte. Si une information manque (ex. résultat non chiffré), laisse le champ synthétique mais signale le manque dans tes questions de challenge.

TEXTE BRUT DU CONSULTANT :
"""
${brut}
"""

Réponds UNIQUEMENT par un JSON valide, sans markdown, avec exactement ces clés :
{
  "titre": "titre court et parlant de la pratique",
  "contexte": "contexte / situation en 1-2 phrases",
  "pratique": "le geste concret, étape par étape si utile",
  "resultat": "résultat obtenu (reprends les faits/chiffres du texte ; sinon reste qualitatif)",
  "reproductibilite": "conditions pour reproduire la pratique ailleurs",
  "questions_challenge": ["question 1", "question 2", "question 3"]
}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cle,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: CORE_SHERPA_PERSONA,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!res.ok) {
      const errTxt = await res.text().catch(() => '');
      return { statusCode: 502, headers: cors, body: JSON.stringify({ error: `Anthropic ${res.status}`, detail: errTxt.slice(0, 300) }) };
    }

    const data = await res.json();
    // extraire le texte de la réponse
    const texte = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    // parser le JSON (en retirant d'éventuels backticks)
    const clean = texte.replace(/```json/gi, '').replace(/```/g, '').trim();
    let parsed;
    try { parsed = JSON.parse(clean); }
    catch (e) {
      // si le parsing échoue, on renvoie le texte brut pour ne pas perdre le travail
      return { statusCode: 200, headers: cors, body: JSON.stringify({ brut: texte, parse_ok: false }) };
    }
    return { statusCode: 200, headers: cors, body: JSON.stringify({ ...parsed, parse_ok: true }) };
  } catch (e) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};
