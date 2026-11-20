import Anthropic from '@anthropic-ai/sdk'
import type { ProviderConfig } from '@shared/types'
import type { LLMClient, Message, StopReason, ToolCall, TurnRequest, TurnResult } from './types'

/**
 * Adaptateur Claude via le SDK officiel @anthropic-ai/sdk.
 * - streaming + finalMessage()
 * - thinking adaptatif + effort configurable
 * - eager_input_streaming sur les outils (gros fichiers écrits en continu)
 * - fallbacks serveur en cas de refus (beta server-side-fallback)
 * - les blocs natifs (thinking) sont renvoyés tels quels au tour suivant
 */
export class AnthropicClient implements LLMClient {
  private client: Anthropic

  constructor(private cfg: ProviderConfig) {
    this.client = new Anthropic({
      apiKey: cfg.apiKey || undefined,
      baseURL: cfg.baseUrl || undefined,
      maxRetries: 4
    })
  }

  private toParams(messages: Message[]): Anthropic.MessageParam[] {
    const out: Anthropic.MessageParam[] = []
    for (const m of messages) {
      if (m.role === 'user') {
        if (m.images?.length) {
          out.push({
            role: 'user',
            content: [
              ...m.images.map((img) => ({
                type: 'image' as const,
                source: { type: 'base64' as const, media_type: img.mediaType, data: img.data }
              })),
              { type: 'text' as const, text: m.content || 'Voir les images jointes.' }
            ]
          })
        } else out.push({ role: 'user', content: m.content })
      } else if (m.role === 'assistant') {
        if (m.native && m.native.providerId === this.cfg.id) {
          out.push({ role: 'assistant', content: m.native.content as Anthropic.ContentBlockParam[] })
        } else {
          const content: Anthropic.ContentBlockParam[] = []
          if (m.text) content.push({ type: 'text', text: m.text })
          for (const c of m.toolCalls) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input })
          out.push({ role: 'assistant', content: content.length ? content : [{ type: 'text', text: '…' }] })
        }
      } else {
        out.push({
          role: 'user',
          content: m.results.map((r) => ({
            type: 'tool_result' as const,
            tool_use_id: r.id,
            content: r.content,
            is_error: r.isError || undefined
          }))
        })
      }
    }
    return out
  }

  async runTurn(req: TurnRequest): Promise<TurnResult> {
    // Les passerelles « compatible Anthropic » n'acceptent pas forcément les extensions
    // (thinking adaptatif, effort, cache d'outils, fallbacks) : on ne les envoie qu'à Anthropic.
    const native = this.cfg.kind === 'anthropic'
    const tools: Anthropic.Tool[] = req.tools.map((t, i) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool.InputSchema,
      ...(native
        ? {
            eager_input_streaming: true,
            // cache du préfixe (tools + system) sur le dernier outil
            ...(i === req.tools.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {})
          }
        : {})
    }))

    const isClaude5 = /claude-(opus|sonnet|fable|mythos|haiku)-5/.test(this.cfg.model)
    const params = {
      model: this.cfg.model,
      max_tokens: this.cfg.maxTokens || (native ? 64000 : 32000),
      system: native
        ? [
            { type: 'text' as const, text: req.systemStatic, cache_control: { type: 'ephemeral' as const } },
            ...(req.systemDynamic ? [{ type: 'text' as const, text: req.systemDynamic }] : [])
          ]
        : [req.systemStatic, req.systemDynamic].filter(Boolean).join('\n\n'),
      tools,
      messages: this.toParams(req.messages),
      ...(native ? { thinking: { type: 'adaptive' as const, display: 'summarized' as const }, output_config: { effort: this.cfg.effort ?? 'high' } } : {}),
      ...(native && isClaude5 && !this.cfg.baseUrl ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {})
    }

    const stream = this.client.beta.messages.stream(
      params as unknown as Parameters<typeof this.client.beta.messages.stream>[0],
      { signal: req.signal }
    )
    stream.on('text', (delta: string) => req.onText(delta))
    let streamedReasoning = ''
    stream.on('thinking', (delta: string) => {
      streamedReasoning += delta
      req.onReasoning?.(delta)
    })

    let message: Anthropic.Beta.BetaMessage
    try {
      message = await stream.finalMessage()
    } catch (err) {
      if (err instanceof Anthropic.APIError) throw err
      if (req.signal.aborted) throw err
      // JSON d'outil impossible à parser (stream interrompu) : on signale un tour invalide
      return { text: '', toolCalls: [], stop: 'other' }
    }

    let text = ''
    let reasoning = ''
    const toolCalls: ToolCall[] = []
    for (const b of message.content) {
      if (b.type === 'text') text += b.text
      if (b.type === 'thinking') reasoning += b.thinking
      if (b.type === 'tool_use') {
        const input = b.input && typeof b.input === 'object' ? (b.input as Record<string, unknown>) : {}
        toolCalls.push({ id: b.id, name: b.name, input })
      }
    }

    const stopMap: Record<string, StopReason> = {
      end_turn: 'end',
      tool_use: 'tool_use',
      max_tokens: 'max_tokens',
      refusal: 'refusal',
      stop_sequence: 'end',
      pause_turn: 'other'
    }

    return {
      text,
      reasoning: reasoning || streamedReasoning,
      toolCalls,
      stop: stopMap[message.stop_reason ?? ''] ?? 'other',
      native: { providerId: this.cfg.id, content: message.content },
      usage: {
        input: message.usage.input_tokens,
        output: message.usage.output_tokens,
        cacheRead: message.usage.cache_read_input_tokens ?? 0,
        cacheWrite: message.usage.cache_creation_input_tokens ?? 0
      }
    }
  }
}

export async function listAnthropicModels(cfg: ProviderConfig): Promise<{ id: string; label?: string }[]> {
  const client = new Anthropic({ apiKey: cfg.apiKey || undefined, baseURL: cfg.baseUrl || undefined })
  const out: { id: string; label?: string }[] = []
  for await (const m of client.models.list()) out.push({ id: m.id, label: m.display_name })
  return out
}
