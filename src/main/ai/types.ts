/**
 * Format de conversation neutre : le moteur agent ne connaît que ces types.
 * Chaque adaptateur (Anthropic, OpenAI-compatible) les traduit vers son API.
 */

export interface ToolSchema {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  /** true si l'entrée n'a pas pu être parsée (JSON invalide / tronqué) */
  invalid?: boolean
}

export interface ToolResult {
  id: string
  name: string
  content: string
  isError?: boolean
}

import type { ImageAttachment } from '@shared/types'

export type Message =
  | { role: 'user'; content: string; images?: ImageAttachment[]; /** identifiant du message affiché (retour arrière) */ id?: string }
  | {
      role: 'assistant'
      text: string
      toolCalls: ToolCall[]
      /** Contenu natif du fournisseur (ex : blocs thinking Claude) à renvoyer tel quel */
      native?: { providerId: string; content: unknown }
    }
  | { role: 'tool'; results: ToolResult[] }

export type StopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'other'

export interface TurnResult {
  text: string
  toolCalls: ToolCall[]
  stop: StopReason
  /** Raisonnement complet du tour (affichage uniquement) */
  reasoning?: string
  native?: { providerId: string; content: unknown }
  usage?: { input: number; output: number; cacheRead?: number; cacheWrite?: number }
}

export interface TurnRequest {
  /** Instructions stables : identiques d'un tour à l'autre, mises en cache par le fournisseur. */
  systemStatic: string
  /** Contexte variable (mémoire du projet, date, secrets) : ajouté après le point de cache. */
  systemDynamic: string
  messages: Message[]
  tools: ToolSchema[]
  signal: AbortSignal
  onText: (delta: string) => void
  /** Flux du raisonnement (thinking, reasoning_content) quand le modèle en produit */
  onReasoning?: (delta: string) => void
}

export interface LLMClient {
  runTurn(req: TurnRequest): Promise<TurnResult>
}
