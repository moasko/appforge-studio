import { spawn, type ChildProcess } from 'child_process'
import { loadSettings } from './settings'

/** Environnement commun : PATH du système + secrets de l'utilisateur + mode non-interactif */
export function buildEnv(extra: Record<string, string> = {}, interactive = false): NodeJS.ProcessEnv {
  // Variables internes d'Electron / outils de dev qui casseraient les projets de l'utilisateur
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/^(ELECTRON_|TSX_|VITE_|NODE_OPTIONS$|NODE_ENV$)/i.test(k))
  )
  const env: NodeJS.ProcessEnv = {
    ...inherited,
    ...loadSettings().secrets,
    FORCE_COLOR: '0',
    EXPO_NO_TELEMETRY: '1',
    NPM_CONFIG_FUND: 'false',
    NPM_CONFIG_AUDIT: 'false',
    ...extra
  }
  // CI=1 évite les prompts interactifs (npm, expo, eas...) pour que l'agent ne reste jamais bloqué
  if (!interactive) env.CI = '1'
  return env
}

export function spawnShell(command: string, cwd: string, interactive = false): ChildProcess {
  return spawn(command, {
    cwd,
    shell: true,
    env: buildEnv({}, interactive),
    windowsHide: true
  })
}

export function killTree(child: ChildProcess): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
  }
}

export interface RunResult {
  exitCode: number | null
  output: string
  timedOut: boolean
}

/** Exécute une commande jusqu'à la fin (avec timeout) et renvoie la sortie combinée. */
export function runCommand(
  command: string,
  cwd: string,
  opts: { timeoutMs?: number; onChunk?: (s: string) => void; signal?: AbortSignal } = {}
): Promise<RunResult> {
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000
  return new Promise((resolve) => {
    const child = spawnShell(command, cwd)
    let output = ''
    let timedOut = false
    const onData = (b: Buffer): void => {
      const s = stripAnsi(b.toString())
      output += s
      if (output.length > 400_000) output = output.slice(-300_000)
      opts.onChunk?.(s)
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.stdin?.end()
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, timeoutMs)
    const abort = (): void => killTree(child)
    opts.signal?.addEventListener('abort', abort)
    child.on('close', (code) => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', abort)
      resolve({ exitCode: code, output, timedOut })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ exitCode: -1, output: output + '\n' + err.message, timedOut })
    })
  })
}

// eslint-disable-next-line no-control-regex
const ANSI = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g
export const stripAnsi = (s: string): string => s.replace(ANSI, '')

/** Vérifie la présence des outils système utiles */
export async function checkEnvironment(): Promise<Record<string, string | null>> {
  const cmds: Record<string, string> = {
    node: 'node -v',
    npm: 'npm -v',
    git: 'git --version',
    docker: 'docker --version',
    eas: 'eas --version',
    flyctl: 'flyctl version',
    railway: 'railway --version',
    vercel: 'vercel --version',
    java: 'java -version',
    adb: 'adb version'
  }
  const out: Record<string, string | null> = {}
  await Promise.all(
    Object.entries(cmds).map(async ([k, c]) => {
      const r = await runCommand(c, process.cwd(), { timeoutMs: 15_000 })
      out[k] = r.exitCode === 0 ? r.output.trim().split('\n')[0].slice(0, 80) : null
    })
  )
  return out
}
