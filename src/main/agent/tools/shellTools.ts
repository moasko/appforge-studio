import { safeResolve } from '../../services/fileService'
import { runCommand } from '../../services/shell'
import { processManager } from '../../services/processManager'
import { checkCommand } from '../safety'
import { clip, num, str, type AgentTool } from './types'

export const runCommandTool: AgentTool = {
  risk: 'exec',
  schema: {
    name: 'run_command',
    description: [
      "Exécute une commande shell NON interactive dans le projet et attend la fin (CI=1 est défini, aucun prompt n'est possible).",
      `Shell: ${process.platform === 'win32' ? 'cmd.exe (Windows) — utilise && pour chaîner, pas de syntaxe bash spécifique' : 'sh'}.`,
      'Utilise-le pour: npm install, npx expo install, tsc --noEmit, tests, migrations, git, eas build --non-interactive, déploiements CLI...',
      "N'utilise PAS cet outil pour les serveurs qui tournent en continu (expo start, npm run dev) : utilise start_process.",
      'Toujours passer les flags non-interactifs (--yes, --non-interactive, -y).'
    ].join(' '),
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        cwd: { type: 'string', description: 'Sous-dossier relatif (ex: "mobile", "api")' },
        timeout_seconds: { type: 'integer', description: 'Défaut 600, max 3600' }
      },
      required: ['command']
    }
  },
  async run(input, ctx) {
    const command = str(input.command)
    const blocked = checkCommand(command)
    if (blocked) throw new Error(blocked)
    const cwd = safeResolve(ctx.root, str(input.cwd))
    const timeoutMs = Math.min(num(input.timeout_seconds, 600), 3600) * 1000
    const r = await runCommand(command, cwd, { timeoutMs, onChunk: ctx.onOutput, signal: ctx.signal })
    const head = r.timedOut ? `⏱ Timeout après ${timeoutMs / 1000}s` : `Code de sortie: ${r.exitCode}`
    return `${head}\n${clip(r.output.trim() || '(aucune sortie)', 14_000)}`
  }
}

export const startProcess: AgentTool = {
  risk: 'exec',
  schema: {
    name: 'start_process',
    description:
      "Démarre un processus long en arrière-plan (serveur API, expo start, base de données docker...). Un label unique par processus (ex: 'api', 'mobile'); relancer avec le même label redémarre. Renvoie les premières lignes de log et les URLs détectées.",
    input_schema: {
      type: 'object',
      properties: {
        label: { type: 'string' },
        command: { type: 'string' },
        cwd: { type: 'string' },
        wait_seconds: { type: 'integer', description: 'Temps à attendre avant de lire les logs (défaut 8)' }
      },
      required: ['label', 'command']
    }
  },
  async run(input, ctx) {
    const command = str(input.command)
    const blocked = checkCommand(command)
    if (blocked) throw new Error(blocked)
    const cwd = safeResolve(ctx.root, str(input.cwd))
    const info = processManager.start(ctx.project.id, str(input.label), command, cwd)
    await new Promise((r) => setTimeout(r, Math.min(num(input.wait_seconds, 8), 60) * 1000))
    const cur = processManager.list(ctx.project.id).find((p) => p.id === info.id)
    return [
      `Processus "${info.label}" : ${cur?.status ?? 'inconnu'}`,
      cur?.urls.length ? `URLs: ${cur.urls.join(', ')}` : '',
      'Logs:',
      clip(processManager.logs(info.id, 8000) || '(pas encore de sortie)', 8000)
    ]
      .filter(Boolean)
      .join('\n')
  }
}

export const processLogs: AgentTool = {
  risk: 'read',
  schema: {
    name: 'process_logs',
    description: "Lit les derniers logs d'un processus démarré avec start_process (pour vérifier erreurs, compilation, requêtes).",
    input_schema: {
      type: 'object',
      properties: { label: { type: 'string' }, tail: { type: 'integer', description: 'Nb de caractères (défaut 6000)' } },
      required: ['label']
    }
  },
  async run(input, ctx) {
    const p = processManager
      .list(ctx.project.id)
      .filter((x) => x.label === str(input.label))
      .sort((a, b) => b.startedAt - a.startedAt)[0]
    if (!p) return `Aucun processus "${input.label}". Processus: ${processManager.list(ctx.project.id).map((x) => x.label).join(', ') || 'aucun'}`
    return `Statut: ${p.status}${p.exitCode != null ? ` (code ${p.exitCode})` : ''}\nURLs: ${p.urls.join(', ') || '-'}\n${processManager.logs(p.id, num(input.tail, 6000))}`
  }
}

export const stopProcess: AgentTool = {
  risk: 'exec',
  schema: {
    name: 'stop_process',
    description: 'Arrête un processus démarré avec start_process.',
    input_schema: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] }
  },
  async run(input, ctx) {
    const list = processManager.list(ctx.project.id).filter((x) => x.label === str(input.label) && x.status === 'running')
    list.forEach((p) => processManager.stop(p.id))
    return list.length ? `Arrêté: ${input.label}` : `Aucun processus actif "${input.label}"`
  }
}

export const listProcesses: AgentTool = {
  risk: 'read',
  schema: {
    name: 'list_processes',
    description: 'Liste les processus en arrière-plan du projet.',
    input_schema: { type: 'object', properties: {} }
  },
  async run(_input, ctx) {
    const list = processManager.list(ctx.project.id)
    return list.length
      ? list.map((p) => `- ${p.label} [${p.status}] ${p.command} ${p.urls.length ? '→ ' + p.urls.join(', ') : ''}`).join('\n')
      : 'Aucun processus.'
  }
}
