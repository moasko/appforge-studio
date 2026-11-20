import fs from 'fs'
import os from 'os'
import path from 'path'
import { runCommand } from '../../services/shell'
import { writeText } from '../../services/fileService'
import { backendFiles, BACKEND_DEPS, BACKEND_DEV_DEPS } from '../templates/backend'
import { MOBILE_BASE_DEPS, mobileExtraFiles, patchAppJson } from '../templates/mobile'
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

export const scaffoldProject: AgentTool = {
  risk: 'exec',
  schema: {
    name: 'scaffold_project',
    description: [
      'Génère la structure professionnelle complète d’un nouveau projet en une fois :',
      '- mobile/ : app Expo (expo-router, TypeScript) via create-expo-app + client API + eas.json',
      '- api/ : backend Hono + Drizzle ORM + SQLite/libSQL (Turso en prod) + auth JWT + zod + Dockerfile, base créée',
      '- fichiers racine : README, AGENTS.md (mémoire du projet), .gitignore, scripts, git init',
      'À appeler UNE SEULE FOIS au début d’un nouveau projet, puis personnaliser le code.'
    ].join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        app_name: { type: 'string', description: 'Nom de l’app (kebab-case)' },
        description: { type: 'string', description: 'Description fonctionnelle de l’app' },
        mobile: { type: 'boolean', description: 'Créer l’app Expo (défaut true)' },
        backend: { type: 'boolean', description: 'Créer le backend + base de données (défaut true)' }
      },
      required: ['app_name', 'description']
    }
  },
  async run(input, ctx) {
    const name = str(input.app_name).toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'app'
    const wantMobile = input.mobile !== false
    const wantBackend = input.backend !== false
    const root = ctx.root
    const log: string[] = []
    const apiUrl = `http://${lanIp()}:3000`

    if (wantMobile && fs.existsSync(path.join(root, 'mobile'))) throw new Error('mobile/ existe déjà : projet déjà initialisé.')

    // 1. Fichiers racine
    const rootFiles: Record<string, string> = {
      '.gitignore': 'node_modules\n.env\n*.db\n*.db-journal\ndist\n.expo\n',
      'package.json': JSON.stringify(
        {
          name,
          private: true,
          scripts: {
            ...(wantBackend ? { 'dev:api': 'npm --prefix api run dev', 'typecheck:api': 'npm --prefix api run typecheck' } : {}),
            ...(wantMobile ? { 'dev:mobile': 'npm --prefix mobile run start', 'typecheck:mobile': 'cd mobile && npx tsc --noEmit' } : {})
          }
        },
        null,
        2
      ),
      'AGENTS.md': `# ${name}

${str(input.description)}

## Architecture
${wantMobile ? '- `mobile/` — App Expo (expo-router, TypeScript). Appels réseau via `mobile/lib/api.ts` (URL dans `mobile/.env` → EXPO_PUBLIC_API_URL).\n' : ''}${wantBackend ? '- `api/` — Backend Hono (Node). Couches : `routes/` (HTTP + validation zod) → `services/` (logique métier) → `db/` (Drizzle schema + client).\n  - Base : SQLite locale (`api/local.db`) en dev, Turso/libSQL en prod (DATABASE_URL + DATABASE_AUTH_TOKEN).\n  - Auth : JWT (Bearer), routes /auth/register, /auth/login, /auth/me.\n  - Après modification de \`src/db/schema.ts\` : \`npm run db:push\` dans api/.\n' : ''}
## Commandes
${wantBackend ? '- API : `npm run dev` dans api/ (port 3000)\n' : ''}${wantMobile ? '- Mobile : `npx expo start` dans mobile/ (scanner le QR avec Expo Go)\n' : ''}
## Conventions
- TypeScript strict partout, pas de \`any\`.
- Toute nouvelle route API : schéma zod + service + test via http_request.
- Garder ce fichier à jour (décisions, URLs de déploiement, état d'avancement).

## Mémoire de l'agent
- L'agent maintient \`.appforge/memory.json\` (faits vérifiés, plan de conception, décisions, pièges), injecté dans son contexte à chaque tour. Ce fichier est le sien : ne le modifiez pas à la main.
- La conception de l'UI découle d'un plan produit par l'agent (catégorie \`design\` de la mémoire), pas d'un template : direction, palette, typographie, écrans, composants.
- AGENTS.md reste la documentation lisible par l'humain ; ce fichier sert de source initiale à la mémoire.

## Journal
- Projet initialisé par AppForge Studio.
`,
      'README.md': `# ${name}\n\n${str(input.description)}\n\nVoir AGENTS.md pour l'architecture et les commandes. La mémoire de l'agent (faits et décisions durables) vit dans \`.appforge/memory.json\`.\n`
    }
    for (const [p, c] of Object.entries(rootFiles)) writeText(root, p, c)
    log.push('✔ Fichiers racine')

    // 2. Mobile
    if (wantMobile) {
      const ok = await step(
        ctx,
        log,
        'Création de l’app Expo',
        'npx --yes create-expo-app@latest mobile --template default --yes',
        root,
        20
      )
      if (ok) {
        for (const [p, c] of Object.entries(mobileExtraFiles(apiUrl))) writeText(root, p, c)
        // create-expo-app peut initialiser un repo git imbriqué : on le retire pour un repo unique
        fs.rmSync(path.join(root, 'mobile', '.git'), { recursive: true, force: true })
        log.push(`✔ mobile/lib/api.ts, .env (API: ${apiUrl}), eas.json`)

        const mobileDir = path.join(root, 'mobile')
        await step(ctx, log, 'Bibliothèques Expo de base', `npx expo install ${MOBILE_BASE_DEPS.join(' ')}`, mobileDir, 10)

        const appJsonPath = path.join(mobileDir, 'app.json')
        if (fs.existsSync(appJsonPath)) {
          const hasSplashImage = fs.existsSync(path.join(mobileDir, 'assets', 'images', 'splash-icon.png'))
          const patched = patchAppJson(fs.readFileSync(appJsonPath, 'utf8'), { hasSplashImage })
          fs.writeFileSync(appJsonPath, patched, 'utf8')
          log.push('✔ app.json aligné (thème automatique, splash, expo-system-ui)')
        }
      }
    }

    // 3. Backend
    if (wantBackend) {
      for (const [p, c] of Object.entries(backendFiles(name))) writeText(root, p, c)
      log.push('✔ Code backend (Hono + Drizzle + JWT)')
      const apiDir = path.join(root, 'api')
      if (await step(ctx, log, 'Dépendances backend', `npm install ${BACKEND_DEPS}`, apiDir)) {
        await step(ctx, log, 'Dépendances de dev backend', `npm install -D ${BACKEND_DEV_DEPS}`, apiDir)
        await step(ctx, log, 'Création de la base de données', 'npx drizzle-kit push --force', apiDir, 5)
        await step(ctx, log, 'Vérification TypeScript backend', 'npx tsc --noEmit', apiDir, 5)
      }
    }

    // 4. Git
    await step(ctx, log, 'Initialisation git', 'git init && git add -A && git commit -m "chore: initial scaffold (AppForge)" --no-verify -q', root, 2)

    return [
      'Scaffolding terminé :',
      ...log,
      '',
      `IP LAN détectée pour l’API (téléphone) : ${apiUrl}`,
      'Étapes suivantes : adapter le schéma DB et les routes à la demande, construire les écrans, lancer api (start_process label "api", "npm run dev", cwd "api") et mobile (label "mobile", "npx expo start", cwd "mobile"), puis vérifier.'
    ].join('\n')
  }
}
