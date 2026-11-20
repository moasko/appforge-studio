import { app, safeStorage } from 'electron'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'
import type { AppSettings, ProviderConfig } from '@shared/types'
import { PROVIDER_PRESETS } from '@shared/types'

/**
 * Stockage des réglages dans userData/settings.json.
 * Les clés API et secrets sont chiffrés avec safeStorage (DPAPI sous Windows, Keychain sous macOS).
 */
const file = (): string => path.join(app.getPath('userData'), 'settings.json')

const defaults = (): AppSettings => ({
  providers: [
    { id: randomUUID(), name: 'Ollama (local)', ...PROVIDER_PRESETS.ollama },
    { id: randomUUID(), name: 'LM Studio (local)', ...PROVIDER_PRESETS.lmstudio },
    { id: randomUUID(), name: 'Claude', ...PROVIDER_PRESETS.anthropic }
  ],
  activeProviderId: null,
  approvalMode: 'autopilot',
  maxIterations: 150,
  workspaceDir: path.join(os.homedir(), 'AppForgeProjects'),
  theme: 'dark',
  secrets: {}
})

const enc = (v: string): string =>
  safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(v).toString('base64') : 'raw:' + v
const dec = (v: string): string => {
  if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'))
  if (v.startsWith('raw:')) return v.slice(4)
  return v
}

let cache: AppSettings | null = null

export function loadSettings(): AppSettings {
  if (cache) return cache
  let s = defaults()
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'))
    s = { ...s, ...raw }
    s.providers = (raw.providers ?? s.providers).map((p: ProviderConfig) => ({
      ...p,
      apiKey: p.apiKey ? safeDec(p.apiKey) : undefined
    }))
    s.secrets = Object.fromEntries(Object.entries(raw.secrets ?? {}).map(([k, v]) => [k, safeDec(v as string)]))
  } catch {
    /* premier lancement */
  }
  if (!s.activeProviderId && s.providers[0]) s.activeProviderId = s.providers[0].id
  cache = s
  return s
}

function safeDec(v: string): string {
  try {
    return dec(v)
  } catch {
    return ''
  }
}

export function saveSettings(next: AppSettings): void {
  cache = next
  const onDisk = {
    ...next,
    providers: next.providers.map((p) => ({ ...p, hasApiKey: undefined, apiKey: p.apiKey ? enc(p.apiKey) : undefined })),
    secrets: Object.fromEntries(Object.entries(next.secrets).map(([k, v]) => [k, enc(v)]))
  }
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file(), JSON.stringify(onDisk, null, 2))
}

/** Version sans secrets en clair, pour l'interface */
export function publicSettings(): AppSettings {
  const s = loadSettings()
  return {
    ...s,
    providers: s.providers.map((p) => ({ ...p, apiKey: undefined, hasApiKey: !!p.apiKey })),
    secrets: Object.fromEntries(Object.keys(s.secrets).map((k) => [k, s.secrets[k] ? '••••••••' : '']))
  }
}

/** Fusionne les réglages venant de l'UI sans écraser les secrets masqués */
export function updateFromUi(partial: Partial<AppSettings>): AppSettings {
  const cur = loadSettings()
  const next: AppSettings = { ...cur, ...partial, providers: cur.providers, secrets: cur.secrets }
  if (partial.secrets) {
    const secrets: Record<string, string> = {}
    for (const [k, v] of Object.entries(partial.secrets)) {
      secrets[k] = v === '••••••••' ? (cur.secrets[k] ?? '') : v
    }
    next.secrets = secrets
  }
  saveSettings(next)
  return publicSettings()
}

export function upsertProvider(p: ProviderConfig): AppSettings {
  const s = loadSettings()
  const existing = s.providers.find((x) => x.id === p.id)
  const merged: ProviderConfig = {
    ...p,
    id: p.id || randomUUID(),
    apiKey: p.apiKey === undefined || p.apiKey === '' ? existing?.apiKey : p.apiKey,
    hasApiKey: undefined
  }
  s.providers = existing ? s.providers.map((x) => (x.id === merged.id ? merged : x)) : [...s.providers, merged]
  if (!s.activeProviderId) s.activeProviderId = merged.id
  saveSettings(s)
  return publicSettings()
}

export function deleteProvider(id: string): AppSettings {
  const s = loadSettings()
  s.providers = s.providers.filter((p) => p.id !== id)
  if (s.activeProviderId === id) s.activeProviderId = s.providers[0]?.id ?? null
  saveSettings(s)
  return publicSettings()
}

export function getActiveProvider(): ProviderConfig | null {
  const s = loadSettings()
  return s.providers.find((p) => p.id === s.activeProviderId) ?? null
}
