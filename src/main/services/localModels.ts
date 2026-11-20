import os from 'os'
import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import type { GpuInfo, MachineInfo } from '@shared/localModels'
import { LOCAL_MODELS } from '@shared/localModels'
import { PROVIDER_PRESETS, type AppSettings, type ProcessInfo } from '@shared/types'
import { loadSettings, saveSettings, publicSettings } from './settings'
import { processManager } from './processManager'

/** Projet fictif des téléchargements de modèles (hors projets utilisateur) */
export const SYSTEM_PROJECT = '__system__'

function run(file: string, args: string[], timeout = 8000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout) => resolve(err ? null : String(stdout)))
  })
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 2500)
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(t)
    return res.ok ? ((await res.json()) as T) : null
  } catch {
    return null
  }
}

async function detectGpus(): Promise<GpuInfo[]> {
  // NVIDIA : mémoire exacte quand nvidia-smi répond
  const smi = await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'])
  if (smi) {
    const gpus = smi
      .split('\n')
      .map((l) => l.split(','))
      .filter((p) => p.length === 2 && p[0].trim())
      .map(([name, mib]) => ({ name: name.trim(), vramGB: Math.round(Number(mib) / 1024) }))
    if (gpus.length) return gpus
  }
  if (process.platform === 'win32') {
    // Le registre donne la mémoire sur 64 bits (Win32_VideoController plafonne à 4 Go)
    const ps = await run('powershell.exe', [
      '-NoProfile',
      '-Command',
      "Get-ItemProperty 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' -ErrorAction SilentlyContinue | ForEach-Object { \"$($_.DriverDesc)|$($_.'HardwareInformation.qwMemorySize')\" }"
    ])
    if (ps) {
      return ps
        .split(/\r?\n/)
        .map((l) => l.split('|'))
        .filter(([name]) => name && !/basic display|remote|virtual|parsec|meta/i.test(name))
        .map(([name, bytes]) => ({ name: name.trim(), vramGB: Number(bytes) > 0 ? Math.round(Number(bytes) / 1024 ** 3) : null }))
    }
  }
  return []
}

export async function machineInfo(): Promise<MachineInfo> {
  const [gpus, ollamaVersion, tags] = await Promise.all([
    detectGpus(),
    run('ollama', ['--version'], 5000),
    getJson<{ models?: { name: string }[] }>('http://localhost:11434/api/tags')
  ])
  let lm: { data?: { id: string }[] } | null = null
  for (const port of [1234, 1235]) {
    lm = await getJson(`http://localhost:${port}/v1/models`)
    if (lm) break
  }
  const cpus = os.cpus()
  return {
    ramGB: Math.round(os.totalmem() / 1024 ** 3),
    cpu: cpus[0]?.model.trim() ?? 'Processeur inconnu',
    cores: cpus.length,
    gpus,
    unifiedMemory: process.platform === 'darwin' && process.arch === 'arm64',
    ollama: { installed: !!ollamaVersion || !!tags, running: !!tags, models: (tags?.models ?? []).map((m) => m.name) },
    lmstudio: { running: !!lm, models: (lm?.data ?? []).map((m) => m.id) }
  }
}

/** Télécharge un modèle du catalogue avec Ollama ; la progression passe par les événements de processus. */
export function pullModel(tag: string): ProcessInfo {
  if (!LOCAL_MODELS.some((m) => m.ollama === tag)) throw new Error('Modèle hors catalogue')
  return processManager.start(SYSTEM_PROJECT, `ollama pull ${tag}`, `ollama pull ${tag}`, os.homedir())
}

/** Fait du modèle le fournisseur actif (crée le fournisseur Ollama s'il n'existe plus). */
export function useModel(tag: string): AppSettings {
  if (!LOCAL_MODELS.some((m) => m.ollama === tag)) throw new Error('Modèle hors catalogue')
  const s = loadSettings()
  let p = s.providers.find((x) => x.kind === 'ollama')
  if (!p) {
    p = { id: randomUUID(), name: 'Ollama (local)', ...PROVIDER_PRESETS.ollama }
    s.providers.push(p)
  }
  p.model = tag
  p.toolMode = 'native'
  s.activeProviderId = p.id
  saveSettings(s)
  return publicSettings()
}
