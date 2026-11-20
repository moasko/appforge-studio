import type { ProviderConfig } from '@shared/types'
import { loadSettings, saveSettings } from './settings'

/**
 * Détection des serveurs IA locaux au démarrage :
 * - corrige l'URL de LM Studio / Ollama si le serveur écoute sur un autre port
 * - choisit automatiquement un modèle chargé si aucun n'est configuré
 * - active le fournisseur local si aucun fournisseur actif n'est utilisable
 */
const CANDIDATES: Record<'lmstudio' | 'ollama', string[]> = {
  lmstudio: ['http://localhost:1234/v1', 'http://localhost:1235/v1', 'http://127.0.0.1:1234/v1'],
  ollama: ['http://localhost:11434/v1']
}

async function models(baseUrl: string): Promise<string[] | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 2500)
    const res = await fetch(baseUrl.replace(/\/$/, '') + '/models', { signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return null
    const j = (await res.json()) as { data?: { id: string }[] }
    return (j.data ?? []).map((m) => m.id).filter((id) => !/embed/i.test(id))
  } catch {
    return null
  }
}

export async function detectLocalProviders(): Promise<void> {
  const s = loadSettings()
  let changed = false
  const reachable: ProviderConfig[] = []

  for (const p of s.providers) {
    if (p.kind !== 'lmstudio' && p.kind !== 'ollama') continue
    const urls = [p.baseUrl ?? '', ...CANDIDATES[p.kind].filter((u) => u !== p.baseUrl)].filter(Boolean)
    for (const url of urls) {
      const list = await models(url)
      if (!list) continue
      if (p.baseUrl !== url) {
        p.baseUrl = url
        changed = true
      }
      if ((!p.model || !list.includes(p.model)) && list[0]) {
        p.model = list[0]
        changed = true
      }
      reachable.push(p)
      break
    }
  }

  // Aucun fournisseur actif utilisable → bascule sur le premier serveur local joignable
  const active = s.providers.find((p) => p.id === s.activeProviderId)
  const keyless = (p: ProviderConfig): boolean => p.kind === 'lmstudio' || p.kind === 'ollama' || p.kind === 'local'
  const activeUsable = active && (keyless(active) ? reachable.includes(active) : !!active.apiKey)
  if (!activeUsable && reachable[0]) {
    s.activeProviderId = reachable[0].id
    changed = true
  }
  if (changed) saveSettings(s)
}
