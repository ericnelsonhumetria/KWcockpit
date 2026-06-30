# ============================================================
# Variables d'environnement — À RENSEIGNER DANS NETLIFY
# (Site settings → Environment variables), JAMAIS dans le code.
# Ce fichier .env.example ne contient que des exemples vides.
# ============================================================

# --- Supabase ---
SUPABASE_URL=https://votreprojet.supabase.co
# Clé publique (anon) — utilisée côté front pour l'authentification
SUPABASE_ANON_KEY=
# Clé service — UNIQUEMENT côté fonctions serverless (jamais exposée au front)
SUPABASE_SERVICE_KEY=

# --- Qonto (demander une clé en LECTURE SEULE si possible) ---
QONTO_LOGIN=
QONTO_SECRET=

# --- Evoliz ---
EVOLIZ_PUBLIC_KEY=
EVOLIZ_SECRET_KEY=

# --- Origine autorisée pour les appels (l'URL de votre site Netlify) ---
# En production, mettre l'URL exacte plutôt que * pour restreindre.
APP_ORIGIN=https://votre-site.netlify.app
