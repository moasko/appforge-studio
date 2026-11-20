import OpenAI from 'openai'
import { Agent } from 'undici'
import { randomUUID } from 'crypto'

const patientDispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 30_000 })

/** Modèles locaux : prompt compact (moins de tokens à lire sur CPU) */
export const isLocalProvider = (cfg: ProviderConfig): boolean => cfg.kind === 'lmstudio' || cfg.kind === 'ollama' || cfg.kind === 'local'
import type { ProviderConfig } from '@shared/types'
import type { LLMClient, Message, StopReason, ToolCall, ToolSchema, TurnRequest, TurnResult } from './types'

/**
 * Adaptateur pour toute API compatible OpenAI Chat Completions :
 * OpenAI, LM Studio, Ollama (/v1), OpenRouter, Groq, DeepSeek, Mistral, Gemini, Together...
 *
 * Deux modes d'outils :
 *  - native : function calling standard (tools / tool_calls)
 *  - prompt : protocole <tool_call>{json}</tool_call> dans le texte, pour les modèles
 *             locaux qui ne gèrent pas le function calling.
 * En mode native, si le modèle écrit quand même des <tool_call> dans son texte (fréquent
 * avec Qwen/Llama servis localement), ils sont récupérés.
 */
export class OpenAICompatClient implements LLMClient {
  private client: OpenAI

  constructor(private cfg: ProviderConfig) {
    this.client = new OpenAI({
      apiKey: cfg.apiKey || defaultKey(cfg),
      baseURL: cfg.baseUrl || undefined,
      maxRetries: 3,
      timeout: 60 * 60_000,
      // Sans ce dispatcher, Node coupe la requête après 5 min sans en-têtes : un modèle local
      // sur CPU peut mettre plus longtemps que ça juste à lire le prompt.
      fetchOptions: { dispatcher: patientDispatcher } as Record<string, unknown>
    })
  }

  private get promptMode(): boolean {
    return this.cfg.toolMode === 'prompt'
  }

  private toParams(system: string, messages: Message[], tools: ToolSchema[]): OpenAI.Chat.ChatCompletionMessageParam[] {
    const sys = this.promptMode ? system + '\n\n' + promptToolsBlock(tools) : system
    const out: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'system', content: sys }]
    for (const m of messages) {
      if (m.role === 'user') {
        if (m.images?.length) {
          out.push({
            role: 'user',
            content: [
              ...m.images.map((img) => ({ type: 'image_url' as const, image_url: { url: `data:${img.mediaType};base64,${img.data}` } })),
              { type: 'text' as const, text: m.content || 'Voir les images jointes.' }
            ]
          })
        } else out.push({ role: 'user', content: m.content })
      }
      else if (m.role === 'assistant') {
        if (this.promptMode) {
          const calls = m.toolCalls
            .map((c) => `<tool_call>\n${JSON.stringify({ name: c.name, arguments: c.input })}\n</tool_call>`)
            .join('\n')
          out.push({ role: 'assistant', content: [m.text, calls].filter(Boolean).join('\n') || '…' })
        } else {
          out.push({
            role: 'assistant',
            content: m.text || null,
            ...(m.toolCalls.length
              ? {
                  tool_calls: m.toolCalls.map((c) => ({
                    id: c.id,
                    type: 'function' as const,
                    function: { name: c.name, arguments: JSON.stringify(c.input) }
                  }))
                }
              : {})
          })
        }
      } else {
        if (this.promptMode) {
          out.push({
            role: 'user',
            content: m.results
              .map((r) => `<tool_result name="${r.name}"${r.isError ? ' error="true"' : ''}>\n${r.content}\n</tool_result>`)
              .join('\n\n')
          })
        } else {
          for (const r of m.results) {
            out.push({ role: 'tool', tool_call_id: r.id, content: (r.isError && !/^erreur/i.test(r.content) ? 'ERREUR: ' : '') + r.content })
          }
        }
      }
    }
    return out
  }

  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const body: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
      model: this.cfg.model,
      messages: this.toParams([req.systemStatic, req.systemDynamic].filter(Boolean).join('\n\n'), req.messages, req.tools),
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: this.cfg.maxTokens || undefined,
      ...(this.cfg.temperature !== undefined ? { temperature: this.cfg.temperature } : {}),
      ...(!this.promptMode && req.tools.length
        ? {
            tools: req.tools.map((t) => ({
              type: 'function' as const,
              function: { name: t.name, description: t.description, parameters: t.input_schema }
            })),
            tool_choice: 'auto' as const
          }
        : {})
    }
    // Les modèles de raisonnement OpenAI (o*, gpt-5) refusent max_tokens : on bascule sur max_completion_tokens
    if (this.cfg.kind === 'openai' && /^(o\d|gpt-5)/.test(this.cfg.model)) {
      const b = body as unknown as Record<string, unknown>
      b.max_completion_tokens = b.max_tokens
      delete b.max_tokens
      delete b.temperature
    }

    const stream = await this.client.chat.completions.create(body, { signal: req.signal })

    let text = ''
    let reasoning = ''
    let finish: string | null = null
    let usage: { input: number; output: number; cacheRead?: number } | undefined
    const partial = new Map<number, { id: string; name: string; args: string }>()
    const filter = new ToolTagFilter(req.onText)

    for await (const chunk of stream) {
      if (chunk.usage) {
        // prompt_tokens inclut la part servie depuis le cache : on la sépare pour le coût
        const cached = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0
        usage = { input: chunk.usage.prompt_tokens - cached, output: chunk.usage.completion_tokens, cacheRead: cached }
      }
      const choice = chunk.choices?.[0]
      if (!choice) continue
      const d = choice.delta as OpenAI.Chat.ChatCompletionChunk.Choice.Delta & { reasoning_content?: string; reasoning?: string }
      // DeepSeek / LM Studio : reasoning_content ; OpenRouter / Ollama : reasoning
      const think = d.reasoning_content ?? (typeof d.reasoning === 'string' ? d.reasoning : '')
      if (think) {
        reasoning += think
        req.onReasoning?.(think)
      }
      if (d?.content) {
        text += d.content
        filter.push(d.content)
      }
      for (const tc of d?.tool_calls ?? []) {
        const cur = partial.get(tc.index) ?? { id: tc.id ?? randomUUID(), name: '', args: '' }
        if (tc.id) cur.id = tc.id
        if (tc.function?.name) cur.name += tc.function.name
        if (tc.function?.arguments) cur.args += tc.function.arguments
        partial.set(tc.index, cur)
      }
      if (choice.finish_reason) finish = choice.finish_reason
    }

    let toolCalls: ToolCall[] = [...partial.values()].map((p) => {
      const parsed = safeJson(p.args || '{}')
      return { id: p.id, name: p.name, input: parsed ?? {}, invalid: parsed === null }
    })

    // Appels d'outils écrits dans le texte (mode prompt, ou modèle local qui "oublie" le format natif)
    const fromText = parseTextToolCalls(text)
    if (fromText.calls.length && (this.promptMode || toolCalls.length === 0)) {
      toolCalls = [...toolCalls, ...fromText.calls]
      text = fromText.rest
    }

    let stop: StopReason = 'other'
    if (toolCalls.length) stop = 'tool_use'
    else if (finish === 'length') stop = 'max_tokens'
    else if (finish === 'stop' || finish === 'end_turn' || finish === null) stop = 'end'
    else if (finish === 'content_filter') stop = 'refusal'

    return { text: text.trim(), reasoning: reasoning || undefined, toolCalls, stop, usage }
  }
}

function defaultKey(cfg: ProviderConfig): string {
  if (cfg.kind === 'ollama') return 'ollama'
  if (cfg.kind === 'lmstudio') return 'lm-studio'
  if (cfg.kind === 'local') return 'local'
  return 'missing-key'
}

function safeJson(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null
  } catch {
    // Petite réparation : certains modèles locaux oublient l'accolade finale
    try {
      const v = JSON.parse(s + '}')
      return v && typeof v === 'object' ? v : null
    } catch {
      return null
    }
  }
}

const TOOL_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g

export function parseTextToolCalls(text: string): { calls: ToolCall[]; rest: string } {
  const calls: ToolCall[] = []
  for (const m of text.matchAll(TOOL_RE)) {
    let raw = m[1].trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
    const obj = safeJson(raw)
    if (!obj) {
      calls.push({ id: randomUUID(), name: 'invalid_tool_call', input: { raw: raw.slice(0, 500) }, invalid: true })
      continue
    }
    const name = String(obj.name ?? obj.tool ?? '')
    const args = (obj.arguments ?? obj.parameters ?? obj.input ?? {}) as Record<string, unknown> | string
    const input = typeof args === 'string' ? (safeJson(args) ?? {}) : args
    calls.push({ id: randomUUID(), name, input })
    raw = ''
  }
  return { calls, rest: text.replace(TOOL_RE, '').trim() }
}

function promptToolsBlock(tools: ToolSchema[]): string {
  return [
    '# APPEL D’OUTILS',
    'Tu n’as pas d’API de function calling : pour utiliser un outil, écris exactement ce bloc (JSON valide, chaînes échappées) :',
    '<tool_call>',
    '{"name": "nom_de_l_outil", "arguments": { ... }}',
    '</tool_call>',
    'Tu peux enchaîner plusieurs blocs <tool_call>. Après tes appels, ARRÊTE-TOI : les résultats arriveront dans des balises <tool_result>.',
    'Quand la tâche est totalement terminée, réponds sans aucun <tool_call>.',
    '',
    '## Outils disponibles',
    ...tools.map((t) => `### ${t.name}\n${t.description}\nParamètres (JSON Schema): ${JSON.stringify(t.input_schema)}`)
  ].join('\n')
}

/** Masque les blocs <tool_call>…</tool_call> du flux texte affiché à l'utilisateur */
class ToolTagFilter {
  private buf = ''
  private inside = false
  constructor(private emit: (s: string) => void) {}
  push(s: string): void {
    this.buf += s
    for (;;) {
      if (!this.inside) {
        const i = this.buf.indexOf('<tool_call>')
        if (i === -1) {
          // garder une éventuelle balise partielle en fin de buffer
          const keep = partialTagSuffix(this.buf, '<tool_call>')
          const out = this.buf.slice(0, this.buf.length - keep)
          if (out) this.emit(out)
          this.buf = this.buf.slice(this.buf.length - keep)
          return
        }
        if (i > 0) this.emit(this.buf.slice(0, i))
        this.buf = this.buf.slice(i + '<tool_call>'.length)
        this.inside = true
      } else {
        const j = this.buf.indexOf('</tool_call>')
        if (j === -1) return
        this.buf = this.buf.slice(j + '</tool_call>'.length)
        this.inside = false
      }
    }
  }
}

function partialTagSuffix(s: string, tag: string): number {
  for (let k = Math.min(tag.length - 1, s.length); k > 0; k--) {
    if (s.endsWith(tag.slice(0, k))) return k
  }
  return 0
}

export async function listOpenAIModels(cfg: ProviderConfig): Promise<{ id: string }[]> {
  const client = new OpenAI({ apiKey: cfg.apiKey || defaultKey(cfg), baseURL: cfg.baseUrl || undefined, timeout: 15_000 })
  const out: { id: string }[] = []
  for await (const m of client.models.list()) out.push({ id: m.id })
  return out.sort((a, b) => a.id.localeCompare(b.id))
}
