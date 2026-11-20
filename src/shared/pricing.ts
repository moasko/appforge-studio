import type { ProviderConfig, UsageTotals } from './types'

/**
 * Tarifs publics Claude en dollars par million de tokens (relevés en novembre 2026).
 * Écriture de cache : 1,25 × le prix d'entrée (TTL 5 min).
 * Les autres fournisseurs n'ont pas de tarif intégré : seuls les tokens sont affichés.
 */
interface Price {
  input: number
  output: number
  cacheRead: number
}

const CLAUDE: Record<string, Price> = {
  'claude-fable-5-2': { input: 8, output: 40, cacheRead: 0.2 },
  'claude-mythos-5-2': { input: 8, output: 40, cacheRead: 0.2 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 1 },
  'claude-mythos-5-1': { input: 10, output: 50, cacheRead: 1 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 }
}

const LOCAL_KINDS = new Set(['ollama', 'lmstudio', 'local'])

/** Tarif applicable, 0 pour un modèle local, null si inconnu. */
export function priceFor(p: Pick<ProviderConfig, 'kind' | 'model'>): Price | 0 | null {
  if (LOCAL_KINDS.has(p.kind)) return 0
  // Claude direct, ou via OpenRouter (« anthropic/claude-sonnet-5-5 »)
  const id = p.model.replace(/^anthropic\//, '').replace(/\./g, '-')
  if (p.kind === 'anthropic' || p.kind === 'openai-compatible') return CLAUDE[id] ?? null
  return null
}

export interface TurnUsage {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

/** Ajoute un tour aux totaux. Un seul tour à tarif inconnu rend le coût total inconnu. */
export function addUsage(total: UsageTotals, turn: TurnUsage, p: Pick<ProviderConfig, 'kind' | 'model'>): UsageTotals {
  const price = priceFor(p)
  const cacheRead = turn.cacheRead ?? 0
  const cacheWrite = turn.cacheWrite ?? 0
  let cost: number | null = null
  if (price === 0) cost = 0
  else if (price) {
    cost =
      (turn.input * price.input + turn.output * price.output + cacheRead * price.cacheRead + cacheWrite * price.input * 1.25) / 1e6
  }
  return {
    input: total.input + turn.input,
    output: total.output + turn.output,
    cacheRead: total.cacheRead + cacheRead,
    cacheWrite: total.cacheWrite + cacheWrite,
    cost: total.cost === null || cost === null ? null : total.cost + cost
  }
}

export function formatCost(cost: number | null): string {
  if (cost === null) return '—'
  if (cost === 0) return 'gratuit'
  return cost < 0.01 ? '< 0,01 $' : `${cost.toFixed(2).replace('.', ',')} $`
}

export function formatTokens(n: number): string {
  return n < 1000 ? String(n) : n < 1e6 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1e6).toFixed(2)}M`
}
