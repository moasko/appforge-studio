import type { ModelInfo, ProviderConfig } from '@shared/types'
import type { LLMClient } from './types'
import { AnthropicClient, listAnthropicModels } from './anthropic'
import { OpenAICompatClient, listOpenAIModels } from './openaiCompat'

/** Point d'entrée unique : ajouter un fournisseur = ajouter un case ici. */
export function createClient(cfg: ProviderConfig): LLMClient {
  if (!cfg.model) throw new Error(`Aucun modèle sélectionné pour « ${cfg.name} ». Ouvrez les réglages.`)
  switch (cfg.kind) {
    case 'anthropic':
    case 'anthropic-compatible':
      if (!cfg.apiKey) throw new Error(`Clé API manquante pour « ${cfg.name} » (Réglages → Fournisseurs).`)
      return new AnthropicClient(cfg)
    case 'openai':
    case 'openai-compatible':
    case 'lmstudio':
    case 'ollama':
    case 'local':
      return new OpenAICompatClient(cfg)
  }
}

export async function listModels(cfg: ProviderConfig): Promise<ModelInfo[]> {
  if (cfg.kind === 'anthropic' || cfg.kind === 'anthropic-compatible') return listAnthropicModels(cfg)
  return listOpenAIModels(cfg)
}

/** Test rapide : liste des modèles = connexion + authentification OK */
export async function testProvider(cfg: ProviderConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const models = await listModels(cfg)
    const hasModel = !cfg.model || models.some((m) => m.id === cfg.model)
    return {
      ok: true,
      message: `Connexion OK — ${models.length} modèle(s) disponible(s)${hasModel ? '' : `. ⚠ « ${cfg.model} » n'est pas dans la liste.`}`
    }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}
