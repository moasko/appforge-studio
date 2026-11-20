import fs from 'fs'
import os from 'os'
import path from 'path'
import { runCommand } from '../../services/shell'
import { writeText } from '../../services/fileService'
import { ARCHITECTURES, architectureById, hasBackend, type AppArchitecture } from '@shared/architectures'
import { backendFiles, BACKEND_DEPS, BACKEND_DEV_DEPS } from '../templates/backend'
import { adminFiles, ADMIN_DEPS, ADMIN_DEV_DEPS } from '../templates/admin'
import { mobileDepsFor, mobileExtraFiles, patchAppJson } from '../templates/mobile'
import { str, type AgentTool, type ToolContext } from './types'

/** IP LAN de la machine : indispensable pour qu'un téléphone (Expo Go) joigne l'API locale */
export function lanIp(): string {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal && !/^169\.254/.test(i.address)) return i.address
    }
  }
  return 'localhost'
}

async function step(ctx: ToolContext, log: string[], title: string, cmd: string, cwd: string, timeoutMin = 15): Promise<boolean> {
  ctx.onOutput(`\n▶ ${title}\n$ ${cmd}\n`)
  const r = await runCommand(cmd, cwd, { timeoutMs: timeoutMin * 60_000, onChunk: ctx.onOutput, signal: ctx.signal })
  const ok = r.exitCode === 0
  log.push(`${ok ? '✔' : '✘'} ${title}${ok ? '' : ` (code ${r.exitCode})\n${r.output.slice(-2500)}`}`)
  return ok
}

const ARCH_IDS = ARCHITECTURES.map((a) => a.id)

/** Ancien paramètre booléen « backend » → architecture (compatibilité) */
function resolveArchitecture(input: Record<string, unknown>): AppArchitecture {
  const a = str(input.architecture) as AppArchitecture
  if (ARCH_IDS.includes(a)) return a
  return input.backend === false ? 'local' : 'api'
}

function architectureDoc(arch: AppArchitecture, mobile: boolean): string {
  const lines: string[] = []
  if (mobile) {
    lines.push('- `mobile/` — App Expo (expo-router, TypeScript).')
    if (arch === 'static') lines.push('  - Contenu embarqué dans `mobile/data/` (typé), préférences et favoris dans AsyncStorage (`mobile/lib/preferences.ts`). Aucun serveur.', '  - Mise à jour du contenu sans passer par les stores : `eas update`.')
    if (arch === 'local') lines.push('  - Base SQLite sur l’appareil : `mobile/lib/db.ts` (migrations versionnées), accès aux données dans `mobile/lib/repositories/`. Hors ligne, sans compte.', '  - Nouvelle table ou colonne : ajouter une migration à la fin de `MIGRATIONS`, ne jamais modifier une migration livrée.')
    if (hasBackend(arch)) lines.push('  - Appels réseau via `mobile/lib/api.ts` (URL dans `mobile/.env` → EXPO_PUBLIC_API_URL).')
  }
  if (hasBackend(arch)) {
    lines.push(
      '- `api/` — Backend Hono (Node). Couches : `routes/` (HTTP + validation zod) → `services/` (logique métier) → `db/` (Drizzle schema + client).',
      '  - Base : SQLite locale (`api/local.db`) en dev, Turso/libSQL en prod (DATABASE_URL + DATABASE_AUTH_TOKEN).',
      '  - Auth : JWT (Bearer), routes /auth/register, /auth/login, /auth/me.',
      '  - Après modification de `src/db/schema.ts` : `npm run db:push` dans api/.'
    )
  }
  if (arch === 'api-admin') {
    lines.push(
      '  - Rôles `user` / `admin` ; routes `/admin/*` protégées par `requireAdmin`. Premier admin : `npm run admin:create -- email motdepasse` dans api/.',
      '- `admin/` — Panneau d’administration web (Vite + React + TypeScript), connexion avec un compte admin. URL de l’API dans `admin/.env` (VITE_API_URL).'
    )
  }
  return lines.join('\n')
}

export const scaffoldProject: AgentTool = {
  risk: 'exec',
  schema: {
    name: 'scaffold_project',
    description: [
      'Génère la structure d’un nouveau projet selon l’architecture choisie (voir # Choisir l’architecture) :',
      ...ARCHITECTURES.map((a) => `- ${a.id} : ${a.stack}`),
      'Toujours : fichiers racine (README, AGENTS.md, .gitignore, scripts) et git init.',
      'À appeler UNE SEULE FOIS au début d’un nouveau projet, puis personnaliser le code.'
    ].join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        app_name: { type: 'string', description: 'Nom de l’app (kebab-case)' },
        description: { type: 'string', description: 'Description fonctionnelle de l’app' },
        architecture: {
          type: 'string',
          enum: ARCH_IDS,
          description: 'static | local | api | api-admin : la plus simple qui couvre les besoins'
        },
        mobile: { type: 'boolean', description: 'Créer l’app Expo (défaut true)' }
      },
      required: ['app_name', 'description', 'architecture']
    }
  },
  async run(input, ctx) {
    const name = str(input.app_name).toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'app'
    const arch = resolveArchitecture(input)
    const wantMobile = input.mobile !== false
    const wantBackend = hasBackend(arch)
    const wantAdmin = arch === 'api-admin'
    const root = ctx.root
    const log: string[] = [`Architecture : ${arch} (${architectureById(arch).label})`]
    const apiUrl = `http://${lanIp()}:3000`

    if (wantMobile && fs.existsSync(path.join(root, 'mobile'))) throw new Error('mobile/ existe déjà : projet déjà initialisé.')
    if (wantBackend && fs.existsSync(path.join(root, 'api'))) throw new Error('api/ existe déjà : projet déjà initialisé.')

    // 1. Fichiers racine
    const rootFiles: Record<string, string> = {
      '.gitignore': 'node_modules\n.env\n*.db\n*.db-journal\ndist\n.expo\n',
      'package.json': JSON.stringify(
        {
          name,
          private: true,
          scripts: {
            ...(wantBackend ? { 'dev:api': 'npm --prefix api run dev', 'typecheck:api': 'npm --prefix api run typecheck' } : {}),
            ...(wantAdmin ? { 'dev:admin': 'npm --prefix admin run dev', 'build:admin': 'npm --prefix admin run build' } : {}),
            ...(wantMobile ? { 'dev:mobile': 'npm --prefix mobile run start', 'typecheck:mobile': 'cd mobile && npx tsc --noEmit' } : {})
          }
        },
        null,
        2
      ),
      'AGENTS.md': `# ${name}

${str(input.description)}

## Architecture : ${architectureById(arch).label}
${architectureById(arch).when}

${architectureDoc(arch, wantMobile)}

## Commandes
${wantBackend ? '- API : `npm run dev` dans api/ (port 3000)\n' : ''}${wantAdmin ? '- Administration : `npm run dev` dans admin/ (http://localhost:5173)\n' : ''}${wantMobile ? '- Mobile : `npx expo start` dans mobile/ (scanner le QR avec Expo Go)\n' : ''}
## Conventions
- TypeScript strict partout, pas de \`any\`.
${wantBackend ? '- Toute nouvelle route API : schéma zod + service + test via http_request.\n' : ''}- Garder ce fichier à jour (décisions, URLs de déploiement, état d'avancement).
- Changer d’architecture (ex. passer de « local » à « api » pour ajouter des comptes) est une décision : la noter ici avec sa raison.

## Mémoire de l'agent
- L'agent maintient \`.appforge/memory.json\` (faits vérifiés, plan de conception, décisions, pièges), injecté dans son contexte à chaque tour. Ce fichier est le sien : ne le modifiez pas à la main.
- La conception de l'UI découle d'un plan produit par l'agent (catégorie \`design\` de la mémoire), pas d'un template : direction, palette, typographie, écrans, composants.
- AGENTS.md reste la documentation lisible par l'humain ; ce fichier sert de source initiale à la mémoire.

## Journal
- Projet initialisé par AppForge Studio (architecture ${arch}).
`,
      'README.md': `# ${name}\n\n${str(input.description)}\n\nArchitecture : ${architectureById(arch).label}. Voir AGENTS.md pour la structure et les commandes. La mémoire de l'agent (faits et décisions durables) vit dans \`.appforge/memory.json\`.\n`
    }
    for (const [p, c] of Object.entries(rootFiles)) writeText(root, p, c)
    log.push('✔ Fichiers racine')

    // 2. Mobile
    if (wantMobile) {
      const ok = await step(ctx, log, 'Création de l’app Expo', 'npx --yes create-expo-app@latest mobile --template default --yes', root, 20)
      if (ok) {
        const extra = mobileExtraFiles(arch, apiUrl)
        for (const [p, c] of Object.entries(extra)) writeText(root, p, c)
        // create-expo-app peut initialiser un repo git imbriqué : on le retire pour un repo unique
        fs.rmSync(path.join(root, 'mobile', '.git'), { recursive: true, force: true })
        log.push(`✔ ${Object.keys(extra).join(', ')}${wantBackend ? ` (API : ${apiUrl})` : ''}`)

        const mobileDir = path.join(root, 'mobile')
        await step(ctx, log, 'Bibliothèques Expo', `npx expo install ${mobileDepsFor(arch).join(' ')}`, mobileDir, 10)

        const appJsonPath = path.join(mobileDir, 'app.json')
        if (fs.existsSync(appJsonPath)) {
          const hasSplashImage = fs.existsSync(path.join(mobileDir, 'assets', 'images', 'splash-icon.png'))
          fs.writeFileSync(appJsonPath, patchAppJson(fs.readFileSync(appJsonPath, 'utf8'), { hasSplashImage }), 'utf8')
          log.push('✔ app.json aligné (thème automatique, splash, expo-system-ui)')
        }
      }
    }

    // 3. Backend
    if (wantBackend) {
      for (const [p, c] of Object.entries(backendFiles(name, { admin: wantAdmin }))) writeText(root, p, c)
      log.push(`✔ Code backend (Hono + Drizzle + JWT${wantAdmin ? ' + rôles et routes /admin' : ''})`)
      const apiDir = path.join(root, 'api')
      if (await step(ctx, log, 'Dépendances backend', `npm install ${BACKEND_DEPS}`, apiDir)) {
        await step(ctx, log, 'Dépendances de dev backend', `npm install -D ${BACKEND_DEV_DEPS}`, apiDir)
        await step(ctx, log, 'Création de la base de données', 'npx drizzle-kit push --force', apiDir, 5)
        await step(ctx, log, 'Vérification TypeScript backend', 'npx tsc --noEmit', apiDir, 5)
      }
    }

    // 4. Administration web
    if (wantAdmin) {
      for (const [p, c] of Object.entries(adminFiles(name, 'http://localhost:3000'))) writeText(root, p, c)
      log.push('✔ Panneau d’administration (Vite + React)')
      const adminDir = path.join(root, 'admin')
      if (await step(ctx, log, 'Dépendances administration', `npm install ${ADMIN_DEPS}`, adminDir)) {
        await step(ctx, log, 'Dépendances de dev administration', `npm install -D ${ADMIN_DEV_DEPS}`, adminDir)
        await step(ctx, log, 'Vérification TypeScript administration', 'npx tsc --noEmit', adminDir, 5)
      }
    }

    // 5. Git
    await step(ctx, log, 'Initialisation git', 'git init && git add -A && git commit -m "chore: initial scaffold (AppForge)" --no-verify -q', root, 2)

    const next: Record<AppArchitecture, string> = {
      static: 'remplir mobile/data/ avec le vrai contenu, construire les écrans, lancer mobile (start_process label "mobile", "npx expo start", cwd "mobile") puis vérifier.',
      local:
        'envelopper le layout racine dans <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrateDbIfNeeded}>, adapter MIGRATIONS et les repositories au domaine, construire les écrans, lancer mobile puis vérifier.',
      api: 'adapter le schéma DB et les routes à la demande, construire les écrans, lancer api (start_process label "api", "npm run dev", cwd "api") et mobile (label "mobile", "npx expo start", cwd "mobile"), puis vérifier.',
      'api-admin':
        'adapter le schéma, les routes (dont /admin) et les pages admin/ au domaine ; créer le premier admin (npm run admin:create -- email motdepasse dans api/) ; lancer api, admin (label "admin", "npm run dev", cwd "admin") et mobile ; vérifier les trois.'
    }
    return ['Scaffolding terminé :', ...log, '', wantBackend ? `IP LAN détectée pour l’API (téléphone) : ${apiUrl}` : '', `Étapes suivantes : ${next[arch]}`]
      .filter((l) => l !== '')
      .join('\n')
  }
}
