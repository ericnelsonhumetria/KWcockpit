/* KW · Mise en situation Maintenance · fonction ÉVALUATION (recruteur connecté) · v45min
   1 appel IA par invocation : step 0..N-1 (analyse situation) | "synth" | "reset".
   Autorisation : le JWT Supabase du recruteur doit voir le candidat via la RLS. */
const SUPA = process.env.SUPABASE_URL || "https://omftqlvkmjlxoinruayr.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const AKEY = process.env.ANTHROPIC_API_KEY;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HDR = { "Content-Type": "application/json", "Cache-Control": "no-store" };
function out(code, obj) { return { statusCode: code, headers: HDR, body: JSON.stringify(obj) }; }
async function sb(path, opts) {
  opts = opts || {};
  const r = await fetch(SUPA + "/rest/v1/" + path, Object.assign({}, opts, { headers: Object.assign({ apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" }, opts.headers || {}) }));
  const t = await r.text();
  if (!r.ok) throw new Error("Supabase " + r.status + " " + t.slice(0, 300));
  try { return t ? JSON.parse(t) : null; } catch (e) { return t; }
}
async function claude(model, system, messages, maxTok) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": AKEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: model, max_tokens: maxTok, system: system, messages: messages, thinking: { type: "disabled" } })
  });
  const d = await r.json().catch(function () { return {}; });
  if (!r.ok) throw new Error("Anthropic " + r.status + " " + ((d.error && d.error.message) || ""));
  const text = (d.content || []).filter(function (x) { return x.type === "text"; }).map(function (x) { return x.text; }).join("\n").trim();
  if (!text) throw new Error("Réponse IA vide");
  return text;
}

const PUB = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "sb_publishable_RgKYatx7zHx_SJvrvoyt2w_fXhLKQ1w";
const MODEL = process.env.MAINT_EVAL_MODEL || "claude-sonnet-4-6";
const REFS = ["S1 CONVOYEUR QUI REDÉCLENCHE. Cause réelle : roulement du réducteur grippé par défaut de graissage, surintensité équilibrée, déclenchement thermique, moteur sain. Cause racine : graissage trimestriel non réalisé depuis 14 mois, OT reportés puis clôturés sans exécution.\nAttendus : stopper les réarmements ; consigner avant toute intervention ; comprendre thermique = surcharge prolongée ; comparer réglage et plaque ; mesurer les 3 courants (équilibrés, élevés : pas de perte de phase) ; isolement ; désaccoupler pour séparer électrique et mécanique ; échange standard du motoréducteur pour livrer à 8h puis réparation ; remonter à la cause racine (pourquoi les OT sont reportés) ; action système sur le préventif.\nÉliminatoire : relever ou shunter le réglage du thermique ; intervenir sous tension sans consignation délibérément. Erreur : changer le moteur sans mesure.","S2 DÉFAUT INTERMITTENT VÉRIN V3. Cause réelle : filtre FRL colmaté, chute de pression lors des pics de consommation, vérin lent, capteur sain. Cause racine : aucune gamme préventive FRL.\nAttendus : cesser de changer des pièces ; test discriminant via l'automate (capteur jamais activé ou activé en retard) ; mesurer temps de course ; mesurer la pression amont et aval du FRL pendant le cycle ; corréler aux pics de consommation ; purge et cartouche ; gamme préventive FRL généralisée ; retour d'expérience à l'équipe de jour.\nErreurs : allonger la temporisation (masque le symptôme et dégrade la cadence) ; rechanger capteur ou vérin ; monter la pression compresseur sans localiser.","S3 TROIS APPELS SIMULTANÉS. Attendus : refus ferme et argumenté du pontage de la barrière immatérielle, maintenu face au directeur de production ; balisage immédiat de la fuite d'huile (déléguable à un cariste) ; diagnostic de la barrière en priorité par un technicien (goulot, client) ; éclairage planifié ; répartition explicite des deux techniciens ; communication à la production, alternative sur l'autre ligne ; actions d'organisation ensuite (rituels production, revue des pontages existants, gestion des demandes).\nÉliminatoire : accepter le pontage, même temporairement."];
const SIT_EVAL = "Tu es évaluateur expert en maintenance industrielle pour Kaizen Way. Tu analyses UNE mise en situation d'un candidat au poste de responsable maintenance. Tu ne juges que les actions réellement annoncées par le candidat ; ce qui n'est pas dit n'est pas fait. Sois exigeant et factuel.\nRÉPONDS UNIQUEMENT par un objet JSON valide, sans texte autour ni balises de code, au format :\n{\"verdict\":\"Résolue|Partiellement résolue|Non résolue\",\"cause_trouvee\":true,\"cause_racine_traitee\":true,\"actions_pertinentes\":[\"...\"],\"erreurs\":[\"...\"],\"oublis\":[\"...\"],\"securite\":\"...\",\"eliminatoire\":\"\",\"synthese\":\"...\"}\nContraintes de longueur STRICTES : 3 éléments maximum par liste, 18 mots maximum par élément ; securite et synthese : 30 mots maximum chacun ; eliminatoire : chaîne vide si aucun, sinon le fait et une citation courte du candidat.";
const SYNTH = "Tu es évaluateur expert en maintenance industrielle pour Kaizen Way. À partir des analyses des trois situations d'un candidat au poste de RESPONSABLE MAINTENANCE, tu notes la grille et tu conclus sur sa capacité à tenir le poste.\nCRITÈRES (note entière 0 à 5) :\nsecurite : 0 intervient sans consigner, accepte un pontage, relève une protection ; 3 consigne tardivement, refus hésitant ; 5 consignation réflexe, refus ferme, balisage immédiat.\nmethode : 0 change des pièces au hasard ; 3 logique mais tests peu discriminants ; 5 tests qui séparent les causes, du simple au complexe.\ntechnique : 0 mesures inadaptées ou mal interprétées ; 3 interprétation partielle ; 5 instruments justes, valeurs interprétées sans aide (thermique/magnétique, isolement, perte de charge).\ncauseracine : 0 s'arrête à la pièce ; 3 cause technique seulement ; 5 remonte à la cause organisationnelle.\nperennisation : 0 rien ; 3 action ponctuelle ; 5 action système (gammes GMAO, règles de clôture des OT, retour d'expérience).\npilotage : 0 subit l'urgence ; 3 priorise sans répartir ni informer ; 5 arbitre, répartit, informe, tient face à la hiérarchie.\ncapacite_poste : \"Oui\" si le candidat peut tenir le poste dès l'intégration ; \"Oui avec réserves\" s'il le peut avec un accompagnement ciblé ; \"Non\" sinon. Toute situation éliminatoire impose \"Non\".\nRÉPONDS UNIQUEMENT par un objet JSON valide, sans texte autour ni balises de code, au format :\n{\"securite_score\":0,\"securite_commentaire\":\"\",\"methode_score\":0,\"methode_commentaire\":\"\",\"technique_score\":0,\"technique_commentaire\":\"\",\"causeracine_score\":0,\"causeracine_commentaire\":\"\",\"perennisation_score\":0,\"perennisation_commentaire\":\"\",\"pilotage_score\":0,\"pilotage_commentaire\":\"\",\"capacite_poste\":\"\",\"justification\":\"\",\"pointsForts\":[\"\"],\"lacunes\":[\"\"],\"plan_integration\":[\"\"],\"questions_entretien\":[\"\"]}\nObjet À PLAT : aucun objet imbriqué, une seule paire d'accolades.\nContraintes de longueur STRICTES : commentaires 20 mots maximum ; justification 45 mots maximum ; 3 éléments maximum par liste, 18 mots maximum par élément. questions_entretien : questions à poser en entretien pour lever les doutes restants.";
const TITRES = ["S1 Le convoyeur qui redéclenche","S2 Le défaut intermittent","S3 Trois appels en même temps"];
const N = REFS.length;
const SOLUTIONS = [{"id":"S1","titre":"Le convoyeur qui redéclenche","cause":"Roulement du réducteur grippé par défaut de lubrification : surcharge mécanique, courant élevé et équilibré (environ 10,8 A pour un In de 8,2 A), déclenchement thermique. Le moteur est sain (isolement supérieur à 200 MΩ, 4,1 A à vide désaccouplé).","racine":"Graissage trimestriel prévu en GMAO mais non réalisé depuis 14 mois : 4 OT reportés puis clôturés « non réalisé, manque de temps ».","attendus":["Stopper les réarmements et consigner (cadenas, vérification d’absence de tension) avant toute intervention.","Identifier un déclenchement thermique = surcharge prolongée ; comparer le réglage (8,5 A) à la plaque (8,2 A).","Mesurer les 3 courants : équilibrés et élevés, donc ni perte de phase ni défaut moteur : la charge mécanique est en cause.","Isolement puis désaccouplement : moteur sain, défaut côté transmission.","Rotation à la main ou thermographie : point dur sur le réducteur (roulement à 92 °C).","Pour le camion de 8h : échange standard du motoréducteur (1h30), réparation en atelier ensuite.","Cause racine : pourquoi les OT de graissage sont reportés ; graisser la ligne, revoir les OT reportés, interdire la clôture sans exécution."],"pieges":["Relever le réglage du thermique pour que ça tienne (éliminatoire).","Réarmer encore, ou intervenir dans l’armoire sans consignation.","Remplacer le moteur sans aucune mesure."]},{"id":"S2","titre":"Le défaut intermittent","cause":"Filtre du groupe FRL colmaté : la pression aval chute (6 bar vers 3,6 bar) lors des pics de consommation (soufflette voisine, V2 et V4 simultanés). Le vérin V3 devient lent (1,9 s pour une surveillance à 1,5 s). Le capteur est sain.","racine":"Aucune gamme préventive FRL (purge, cartouche) sur la cellule.","attendus":["Arrêter de changer des pièces : le capteur a déjà été changé sans effet.","Test discriminant via l’automate : le capteur n’est jamais activé (capteur/câblage) ou activé en retard (vérin lent) ? Réponse : en retard.","Mesurer le temps de course de V3 (0,8 s normal, 1,9 s en défaut).","Mesurer la pression en aval puis en amont du FRL pendant un cycle : 6,5 bar stable en amont, chute en aval, donc perte localisée au FRL.","Corréler les défauts aux pics de consommation.","Purger et changer la cartouche ; créer une gamme FRL sur toutes les cellules ; retour d’expérience à l’équipe de jour."],"pieges":["Allonger la temporisation de surveillance (masque le symptôme et dégrade la cadence).","Rechanger capteur, câble ou vérin sans test discriminant.","Monter la pression au compresseur sans avoir localisé la perte."]},{"id":"S3","titre":"Trois appels en même temps","cause":"Pas de panne unique : situation de priorisation sous pression, avec une demande de pontage d’une sécurité machine.","racine":"Les pannes réelles : barrière immatérielle au support desserré par les vibrations et à l’optique encrassée (20 min) ; flexible hydraulique suintant au raccord (45 min, en stock) ; éclairage : disjoncteur déclenché par un luminaire en défaut d’isolement.","attendus":["Refus ferme et argumenté du pontage, maintenu face au directeur de production (escalade si besoin).","Mise en sécurité immédiate de la fuite près de l’allée : balisage et absorbant, déléguable au cariste en 5 min.","Un technicien en priorité sur la barrière (ligne goulot, client à 10h) : alignement, optiques, fixation.","Éclairage planifié dans la journée : identifier le luminaire en défaut avant de réarmer.","Répartition explicite des deux techniciens et information de la production ; piste de l’autre ligne (40 % de la commande).","Après coup : rituel production / maintenance, revue des pontages existants sur le site, circuit des demandes."],"pieges":["Accepter le pontage, même une heure (éliminatoire).","Oublier la fuite d’huile au bord de l’allée des chariots.","Tout traiter soi-même sans répartir ni communiquer."]}];
const POIDS = { securite: 2, methode: 2, technique: 2, causeracine: 1, perennisation: 1, pilotage: 1 };

async function claudeT(model, system, messages, maxTok) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": AKEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: model, max_tokens: maxTok, temperature: 0, system: system, messages: messages, thinking: { type: "disabled" } })
  });
  const d = await r.json().catch(function () { return {}; });
  if (!r.ok) throw new Error("Anthropic " + r.status + " " + ((d.error && d.error.message) || ""));
  const text = (d.content || []).filter(function (x) { return x.type === "text"; }).map(function (x) { return x.text; }).join("\n").trim();
  if (!text) throw new Error("Réponse IA vide");
  return text;
}
function balancedEnd(t, start) {
  let depth = 0, inStr = false, escp = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (escp) escp = false; else if (c === "\\") escp = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") { depth--; if (depth === 0) return i; }
  }
  return -1;
}
function tryParseTail(frag) {
  frag = frag.trim(); const cut = frag.lastIndexOf("}");
  if (cut < 0) return null; frag = frag.slice(0, cut + 1);
  for (let k = 0; k < 4; k++) {
    try { return JSON.parse("{" + frag); } catch (e) {}
    try { return JSON.parse("{" + frag + "}"); } catch (e) {}
    if (/\}\s*$/.test(frag)) frag = frag.replace(/\}\s*$/, ""); else break;
  }
  return null;
}
function parseJSON(t) {
  t = String(t).replace(/```json|```/g, "").trim();
  const a = t.indexOf("{"), z = t.lastIndexOf("}");
  if (a < 0 || z <= a) throw new Error("Pas de JSON");
  try { return JSON.parse(t.slice(a, z + 1)); } catch (e0) {}
  const end = balancedEnd(t, a);
  if (end < 0) throw new Error("JSON incomplet (réponse tronquée)");
  const obj = JSON.parse(t.slice(a, end + 1));
  let rest = t.slice(end + 1).trim();
  while (rest) {
    if (rest[0] === "}") { rest = rest.slice(1).trim(); continue; }
    if (rest[0] === ",") { const o2 = tryParseTail(rest.slice(1)); if (o2) Object.assign(obj, o2); break; }
    if (rest[0] === "{") { const e2 = balancedEnd(rest, 0); if (e2 < 0) break; try { Object.assign(obj, JSON.parse(rest.slice(0, e2 + 1))); } catch (e) {} rest = rest.slice(e2 + 1).trim(); continue; }
    break;
  }
  return obj;
}
function transcriptOf(tr) {
  const lines = ["=== " + tr.situation + " · " + tr.titre + " · durée " + Math.round((tr.duree_s || 0) / 60) + " min" + (tr.cloture_forcee ? " (clôture forcée, temps dépassé)" : "") + " ==="];
  (tr.messages || []).forEach(function (m) { lines.push((m.role === "user" ? "CANDIDAT : " : "INTERLOCUTEUR : ") + m.content); });
  lines.push("QUESTION DE CLÔTURE : " + (tr.cloture_question || ""));
  lines.push("CANDIDAT : " + (tr.cloture_reponse || "(pas de réponse)"));
  return lines.join("\n");
}
function compute(ev, analyses) {
  let sum = 0; ev.criteres = {};
  Object.keys(POIDS).forEach(function (k) {
    let n = Number(ev[k + "_score"]); if (!(n >= 0 && n <= 5)) n = 0; n = Math.round(n);
    ev.criteres[k] = { score: n, commentaire: String(ev[k + "_commentaire"] || "") };
    delete ev[k + "_score"]; delete ev[k + "_commentaire"];
    sum += n * POIDS[k];
  });
  let pct = Math.round(sum / 45 * 100);
  const plafond = ev.criteres.technique.score <= 1;
  if (plafond) pct = Math.min(pct, 50);
  const elims = analyses.map(function (a, i) { return a && a.eliminatoire && String(a.eliminatoire).trim() ? { situation: TITRES[i].split(" ")[0], fait: a.eliminatoire } : null; }).filter(Boolean);
  const bande = pct < 40 ? "Insuffisant pour le poste" : pct < 60 ? "Technicien confirmé / chef d’équipe" : pct < 80 ? "Responsable maintenance opérationnel" : "Responsable confirmé";
  if (elims.length) ev.capacite_poste = "Non";
  return Object.assign(ev, { pct: pct, plafond: plafond, eliminatoire: elims.length > 0, eliminatoires: elims, profil: elims.length ? "Éliminé (sécurité) · " + bande : bande, modele: MODEL, date: new Date().toISOString() });
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") return out(405, { error: "POST uniquement" });
  if (!KEY || !AKEY || !PUB) return out(500, { error: "Configuration serveur incomplète (SUPABASE_PUBLISHABLE_KEY, clé service ou clé Anthropic)." });
  const auth = (event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");
  if (!auth) return out(401, { error: "Non connecté" });
  let b; try { b = JSON.parse(event.body || "{}"); } catch (e) { return out(400, { error: "JSON invalide" }); }
  const cid = String(b.candidat_id || "");
  if (!UUID.test(cid)) return out(400, { error: "candidat_id invalide" });
  try {
    const chk = await fetch(SUPA + "/rest/v1/parcours_candidats?id=eq." + cid + "&select=id", { headers: { apikey: PUB, Authorization: "Bearer " + auth } });
    const chkRows = await chk.json().catch(function () { return []; });
    if (!chk.ok || !Array.isArray(chkRows) || chkRows.length !== 1) return out(403, { error: "Accès refusé" });
    if (b.step === "solutions") return out(200, { solutions: SOLUTIONS });

    const rs = await sb("parcours_resultats?candidat_id=eq." + cid + "&epreuve=eq.maintenance&select=id,statut,detail");
    const res = rs && rs[0];
    if (!res) return out(404, { error: "Aucune épreuve enregistrée pour ce candidat" });
    const detail = res.detail || {};
    const trs = detail.transcripts || [];
    const analyses = Array.isArray(detail.analyses) ? detail.analyses.slice(0, N) : [];
    while (analyses.length < N) analyses.push(null);
    const patch = async function (d, score) {
      const body = { detail: d, updated_at: new Date().toISOString() };
      if (score !== undefined) body.score = score;
      await sb("parcours_resultats?id=eq." + res.id, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(body) });
    };
    const extra = b.retry ? "\n\nTA RÉPONSE PRÉCÉDENTE ÉTAIT INVALIDE. Renvoie un JSON strictement valide, aucun texte après l'accolade finale, textes plus courts." : "";

    if (b.step === "reset") {
      delete detail.analyses; delete detail.evaluation;
      await patch(detail, null);
      return out(200, { ok: true });
    }
    if (b.step === "synth") {
      if (analyses.some(function (a) { return !a; })) return out(409, { error: "Analyses de situation incomplètes" });
      const resume = analyses.map(function (a, i) { return TITRES[i] + " : " + JSON.stringify(a); }).join("\n");
      const ev = parseJSON(await claudeT(MODEL, SYNTH + extra, [{ role: "user", content: "Candidat : " + (detail.candidat || "") + "\n\nANALYSES DES TROIS SITUATIONS :\n" + resume }], 1500));
      detail.evaluation = compute(ev, analyses);
      await patch(detail, detail.evaluation.pct);
      return out(200, { ok: true, evaluation: detail.evaluation });
    }
    const i = Number(b.step);
    if (!(i >= 0 && i < N)) return out(400, { error: "step invalide" });
    if (!trs[i]) return out(409, { error: "Transcription " + (i + 1) + " absente (épreuve inachevée ?)" });
    const an = parseJSON(await claudeT(MODEL, SIT_EVAL + extra, [{ role: "user", content: "RÉFÉRENCE DE LA SITUATION :\n" + REFS[i] + "\n\nTRANSCRIPTION :\n" + transcriptOf(trs[i]) }], 1200));
    analyses[i] = an; detail.analyses = analyses;
    await patch(detail);
    return out(200, { ok: true, analyse: an });
  } catch (e) {
    return out(500, { error: String((e && e.message) || e) });
  }
};
