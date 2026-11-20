import type { DeployTarget } from '@shared/types'

/**
 * Cibles d'hébergement / déploiement en un clic.
 * Chaque cible est un "prompt de mission" confié à l'agent, qui exécute toutes les étapes
 * (installation CLI, configuration, build, déploiement, vérification) sans quitter l'app.
 */
export const DEPLOY_TARGETS: DeployTarget[] = [
  {
    id: 'local-stack',
    label: 'Lancer tout en local',
    description: 'API + base + Expo (QR code pour Expo Go sur le téléphone)',
    category: 'mobile',
    requiredSecrets: [],
    prompt:
      "Lance l'environnement de développement complet : vérifie que les dépendances sont installées, démarre l'API (start_process label \"api\", cwd api, npm run dev) si elle existe, vérifie /health avec http_request, vérifie que mobile/.env pointe vers l'IP LAN actuelle, puis démarre Expo (start_process label \"mobile\", cwd mobile, \"npx expo start --lan\"). Corrige toute erreur. Termine en donnant l'URL exp:// à scanner."
  },
  {
    id: 'tunnel',
    label: 'Exposer sur Internet (tunnel)',
    description: 'API accessible publiquement depuis la machine via un tunnel Cloudflare',
    category: 'backend',
    requiredSecrets: [],
    prompt:
      "Expose l'API locale sur Internet sans serveur : assure-toi que l'API tourne (label \"api\"), puis start_process label \"tunnel\" avec \"npx --yes cloudflared tunnel --url http://localhost:3000\". Récupère l'URL https://*.trycloudflare.com dans les logs, teste /health avec http_request, mets EXPO_PUBLIC_API_URL à jour dans mobile/.env et redémarre le processus mobile si présent."
  },
  {
    id: 'eas-android-preview',
    label: 'APK Android (EAS)',
    description: 'Build APK installable directement sur téléphone',
    category: 'mobile',
    requiredSecrets: ['EXPO_TOKEN'],
    prompt:
      "Produis un APK Android installable avec EAS : dans mobile/, vérifie app.json (name, slug, android.package unique type com.<nom>.app, version), lie le projet (npx eas-cli@latest init --non-interactive --force si pas d'extra.eas.projectId), vérifie eas.json (profil preview en apk), mets EXPO_PUBLIC_API_URL sur l'URL de production si elle existe (sinon préviens), puis lance npx eas-cli@latest build --platform android --profile preview --non-interactive --no-wait. Donne le lien de suivi du build et note-le dans AGENTS.md."
  },
  {
    id: 'eas-ios',
    label: 'Build iOS (EAS)',
    description: 'Build iOS pour TestFlight / App Store',
    category: 'mobile',
    requiredSecrets: ['EXPO_TOKEN'],
    prompt:
      "Prépare et lance un build iOS de production avec EAS : vérifie app.json (ios.bundleIdentifier, buildNumber), lie le projet si besoin, puis npx eas-cli@latest build --platform ios --profile production --non-interactive --no-wait. Si des identifiants Apple manquent, explique exactement ce qu'il faut configurer (EXPO_APPLE_ID / ASC API key) et fais tout le reste."
  },
  {
    id: 'eas-update',
    label: 'Mise à jour OTA',
    description: 'Publie le JS sans repasser par les stores (EAS Update)',
    category: 'mobile',
    requiredSecrets: ['EXPO_TOKEN'],
    prompt:
      "Publie une mise à jour OTA : dans mobile/, installe et configure expo-updates si nécessaire (npx expo install expo-updates, npx eas-cli@latest update:configure --non-interactive), vérifie que tsc passe, puis npx eas-cli@latest update --auto --non-interactive. Donne le lien de la mise à jour."
  },
  {
    id: 'turso-db',
    label: 'Base de données Turso',
    description: 'Crée la base libSQL de production et applique le schéma',
    category: 'database',
    requiredSecrets: ['TURSO_API_TOKEN'],
    prompt:
      "Crée la base de production sur Turso : utilise l'API HTTP Turso (http_request avec Authorization: Bearer du secret TURSO_API_TOKEN — lis-le via run_command \"node -e console.log(process.env.TURSO_API_TOKEN?'ok':'absent')\" pour vérifier sa présence sans l'afficher) ou la CLI turso si installée. Récupère l'URL libsql:// et un token, applique le schéma avec drizzle-kit push en passant DATABASE_URL et DATABASE_AUTH_TOKEN, écris-les dans api/.env.production (gitignoré) et note l'URL (sans le token) dans AGENTS.md."
  },
  {
    id: 'fly-backend',
    label: 'Backend sur Fly.io',
    description: 'Déploie l’API (Docker) sur Fly.io avec HTTPS',
    category: 'backend',
    requiredSecrets: ['FLY_API_TOKEN'],
    prompt:
      "Déploie l'API sur Fly.io : vérifie que flyctl est disponible (sinon utilise le script d'installation officiel adapté à l'OS, ou demande de l'installer), vérifie le Dockerfile et que npm run build passe, crée fly.toml (flyctl launch --no-deploy --copy-config --yes --name <nom-unique>), configure les secrets (flyctl secrets set JWT_SECRET=... DATABASE_URL=... DATABASE_AUTH_TOKEN=...) en utilisant la base Turso si elle existe, puis flyctl deploy --remote-only. Teste https://<app>.fly.dev/health, mets à jour EXPO_PUBLIC_API_URL de production et AGENTS.md."
  },
  {
    id: 'railway-backend',
    label: 'Backend sur Railway',
    description: 'Déploie l’API sur Railway',
    category: 'backend',
    requiredSecrets: ['RAILWAY_TOKEN'],
    prompt:
      "Déploie l'API sur Railway avec la CLI (npx --yes @railway/cli) en mode non-interactif : vérifie le build, déploie avec railway up --ci depuis api/, configure les variables (JWT_SECRET, DATABASE_URL, DATABASE_AUTH_TOKEN), génère un domaine public, teste /health et mets à jour EXPO_PUBLIC_API_URL et AGENTS.md."
  },
  {
    id: 'vps-docker',
    label: 'VPS (SSH + Docker)',
    description: 'Déploie sur votre propre serveur via SSH',
    category: 'backend',
    requiredSecrets: ['SSH_HOST', 'SSH_USER'],
    prompt:
      "Déploie l'API sur le VPS de l'utilisateur via SSH (clé SSH déjà configurée sur la machine, hôte $SSH_HOST, utilisateur $SSH_USER) : crée un docker-compose.prod.yml (api + volume pour la base SQLite ou connexion Turso, restart: always), copie le dossier api avec scp -r (en excluant node_modules), puis via ssh -o BatchMode=yes lance docker compose up -d --build. Vérifie http://$SSH_HOST:3000/health. Propose Caddy pour HTTPS si un domaine est fourni."
  },
  {
    id: 'web-vercel',
    label: 'Version web sur Vercel',
    description: 'Exporte l’app Expo en web et la publie',
    category: 'web',
    requiredSecrets: ['VERCEL_TOKEN'],
    prompt:
      "Publie la version web de l'app : dans mobile/, installe les dépendances web si nécessaire (npx expo install react-dom react-native-web), npx expo export --platform web, puis déploie le dossier dist avec npx --yes vercel deploy dist --prod --yes --token %VERCEL_TOKEN% (ou $VERCEL_TOKEN selon l'OS). Teste l'URL et note-la dans AGENTS.md."
  }
]
