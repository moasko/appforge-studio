import { app, powerSaveBlocker } from 'electron'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type { AgentEvent, ChatItem, Project, ToolCallView } from '@shared/types'
import type { Message, ToolCall, ToolResult } from '../ai/types'
import { createClient } from '../ai/registry'
import { getActiveProvider, loadSettings } from '../services/settings'
import { buildSystemPrompt } from './systemPrompt'
import { toolByName, toolSchemas } from './tools'
import { clip, validateInput } from './tools/types'

type Emit = (e: AgentEvent) => void

interface Persisted {
  history: Message[]
  items: ChatItem[]
  /** Marqueur d'exécution en cours : sert à reprendre après un crash ou une coupure. */
  run?: { startedAt: number } | null
}

/** En autopilote, la limite d'itérations est repoussée par segments (mission de nuit). */
const AUTOPILOT_MAX_SEGMENTS = 20
const AUTOPILOT_MAX_MS = 12 * 3600_000
/** Au-delà de cette ancienneté, une exécution interrompue n'est pas reprise automatiquement. */
export const RESUME_MAX_AGE_MS = 24 * 3600_000
/** Plafond du raisonnement conservé pour l'affichage (le natif complet reste dans l'historique fournisseur). */
const REASONING_UI_MAX = 50_000

export const RESUME_PROMPT =
  'La session a été interrompue (crash, veille ou fermeture inattendue) pendant la tâche. Reprends exactement où tu en étais : relis l’état réel des fichiers concernés, termine ce qui reste, vérifie (typecheck, endpoints, UI) puis donne le résumé final.'

/**
 * Session d'agent liée à un projet.
 * Boucle : modèle → appels d'outils → résultats → modèle ... jusqu'à la fin de la tâche.
 * Conçue pour tourner sans interruption (autopilot) : reprise automatique après
 * troncature, retry sur erreurs réseau, compaction du contexte.
 */
export class AgentSession {
  private history: Message[] = []
  private items: ChatItem[] = []
  private abort: AbortController | null = null
  private approvals = new Map<string, (ok: boolean) => void>()
  private activeRun: { startedAt: number } | null = null
  private interruptedAt: number | null = null
  running = false

  constructor(
    private project: Project,
    private emit: Emit
  ) {
    this.load()
  }

  private get file(): string {
    return path.join(app.getPath('userData'), 'sessions', `${this.project.id}.json`)
  }
  private load(): void {
    try {
      const p: Persisted = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      this.history = p.history ?? []
      this.items = p.items ?? []
      if (p.run?.startedAt && Date.now() - p.run.startedAt < RESUME_MAX_AGE_MS) this.interruptedAt = p.run.startedAt
    } catch {
      /* nouvelle session */
    }
  }
  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    // Écriture atomique : un crash pendant la sauvegarde ne corrompt pas la session
    const tmp = this.file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify({ history: this.history, items: this.items.slice(-400), run: this.activeRun }))
    fs.renameSync(tmp, this.file)
  }

  /** Vrai si une exécution a été coupée (crash, arrêt brutal) et peut être reprise. */
  get resumable(): boolean {
    return this.interruptedAt !== null && !this.running
  }

  /** Début de l'exécution en cours (pour le chronomètre de l'UI). */
  get startedAt(): number | null {
    return this.activeRun?.startedAt ?? null
  }

  getItems(): ChatItem[] {
    return this.items
  }

  clear(): void {
    this.history = []
    this.items = []
    this.interruptedAt = null
    this.save()
  }

  stop(): void {
    this.abort?.abort()
    // Arrêt volontaire : la session ne sera pas reprise au prochain lancement
    this.activeRun = null
    for (const r of this.approvals.values()) r(false)
    this.approvals.clear()
    this.save()
  }

  /** Relance une exécution coupée. Sans effet si la session n'est pas dans cet état. */
  async resume(): Promise<void> {
    if (!this.resumable) return
    this.interruptedAt = null
    await this.send(RESUME_PROMPT)
  }

  approve(callId: string, ok: boolean): void {
    this.approvals.get(callId)?.(ok)
    this.approvals.delete(callId)
  }

  async send(text: string): Promise<void> {
    if (this.running) throw new Error('Une tâche est déjà en cours.')
    const provider = getActiveProvider()
    if (!provider) throw new Error('Aucun fournisseur IA configuré.')
    const llm = createClient(provider)
    const settings = loadSettings()
    const runId = randomUUID()
    this.running = true
    this.abort = new AbortController()
    const signal = this.abort.signal

    const userItem: ChatItem = { id: randomUUID(), role: 'user', text, createdAt: Date.now() }
    this.interruptedAt = null
    this.items.push(userItem)
    this.history.push({ role: 'user', content: text })
    this.emit({ type: 'start', runId, startedAt: Date.now() })
    this.emit({ type: 'assistant-item', runId, item: userItem })

    const isLocal = provider.kind === 'ollama' || provider.kind === 'lmstudio' || provider.kind === 'local'
    const isAutopilot = settings.approvalMode === 'autopilot'
    const deadline = Date.now() + AUTOPILOT_MAX_MS
    let blocker: number | null = null
    let segments = 0
    let iterations = 0
    let emptyRetries = 0
    let netRetries = 0
    let reason = 'terminé'

    try {
      // La machine ne doit pas se suspendre pendant une mission de nuit
      blocker = powerSaveBlocker.start('prevent-app-suspension')
      this.activeRun = { startedAt: Date.now() }
      this.save()

      for (;;) {
        if (signal.aborted) {
          reason = 'arrêté'
          break
        }
        if (iterations >= settings.maxIterations) {
          const timedOut = Date.now() >= deadline
          if (!isAutopilot || timedOut || segments >= AUTOPILOT_MAX_SEGMENTS) {
            reason = timedOut ? 'budget de nuit épuisé (12 h)' : `limite de ${settings.maxIterations} itérations atteinte`
            break
          }
          // Autopilote : la mission continue par segments au lieu de s'arrêter
          segments++
          iterations = 0
          this.history.push({
            role: 'user',
            content: `Tu as atteint la limite intermédiaire de ${settings.maxIterations} tours d'outils. Continue la tâche exactement où tu en étais, sans t'arrêter pour demander confirmation.`
          })
          const note: ChatItem = {
            id: randomUUID(),
            role: 'system',
            text: `Autopilote : prolongation ${segments}/${AUTOPILOT_MAX_SEGMENTS}, la mission continue.`,
            createdAt: Date.now()
          }
          this.items.push(note)
          this.emit({ type: 'assistant-item', runId, item: note })
          this.emit({ type: 'status', runId, message: 'Autopilote : la mission continue automatiquement.' })
          this.save()
        }
        iterations++
        this.compact(isLocal ? 90_000 : 700_000, provider.id)

        const item: ChatItem = { id: randomUUID(), role: 'assistant', text: '', reasoning: '', toolCalls: [], createdAt: Date.now() }
        this.items.push(item)
        this.emit({ type: 'assistant-item', runId, item })

        let turn
        try {
          const prompt = buildSystemPrompt(this.project, provider)
          turn = await llm.runTurn({
            systemStatic: prompt.static,
            systemDynamic: prompt.dynamic,
            messages: this.history,
            // En mode prompt (JSON dans le texte), un patch multi-lignes est trop fragile : edit_file seulement
            tools: toolSchemas(isLocal).filter((t) => !(provider.toolMode === 'prompt' && t.name === 'apply_patch')),
            signal,
            onText: (delta) => {
              item.text += delta
              this.emit({ type: 'text-delta', runId, itemId: item.id, delta })
            },
            onReasoning: (delta) => {
              if ((item.reasoning?.length ?? 0) >= REASONING_UI_MAX) return
              item.reasoning = (item.reasoning ?? '') + delta
              this.emit({ type: 'reasoning-delta', runId, itemId: item.id, delta })
            }
          })
          netRetries = 0
        } catch (err) {
          if (signal.aborted) {
            reason = 'arrêté'
            break
          }
          const msg = (err as Error).message ?? String(err)
          const retryable = /429|5\d\d|overloaded|ECONNRESET|ETIMEDOUT|fetch failed|socket|network|timeout|terminated/i.test(msg)
          this.items.pop()
          if (retryable && netRetries++ < 6) {
            const wait = Math.min(60, 5 * 2 ** netRetries)
            this.emit({ type: 'status', runId, message: `Erreur réseau/fournisseur, nouvelle tentative dans ${wait}s… (${msg.slice(0, 120)})` })
            await sleep(wait * 1000, signal)
            iterations--
            continue
          }
          throw err
        }

        if (turn.usage) this.emit({ type: 'usage', runId, inputTokens: turn.usage.input, outputTokens: turn.usage.output })
        item.text = turn.text || item.text
        // Le raisonnement complet du fournisseur fait foi (les deltas peuvent en manquer une partie)
        if (turn.reasoning && turn.reasoning !== item.reasoning) {
          item.reasoning = turn.reasoning.slice(0, REASONING_UI_MAX)
          this.emit({ type: 'assistant-item', runId, item })
        }

        this.history.push({ role: 'assistant', text: turn.text, toolCalls: turn.toolCalls, native: turn.native })

        if (turn.stop === 'refusal') {
          reason = 'refus du modèle'
          break
        }

        if (!turn.toolCalls.length) {
          if (turn.stop === 'max_tokens') {
            // Réponse coupée : on demande la suite sans intervention
            this.history.push({ role: 'user', content: 'Ta réponse a été coupée (limite de tokens). Continue exactement où tu t’es arrêté.' })
            continue
          }
          if (!turn.text.trim() && emptyRetries++ < 2) {
            this.history.pop()
            this.items.pop()
            this.history.push({ role: 'user', content: 'Continue la tâche (utilise les outils si nécessaire, ou donne le résumé final si tout est terminé).' })
            continue
          }
          this.emit({ type: 'assistant-item', runId, item })
          break // tâche terminée
        }

        // Une entrée d'outil tronquée par max_tokens ne doit jamais être exécutée
        if (turn.stop === 'max_tokens') {
          const results: ToolResult[] = turn.toolCalls.map((c) => ({
            id: c.id,
            name: c.name,
            isError: true,
            content: 'Entrée tronquée (limite de tokens atteinte). Découpe en plusieurs appels plus petits (ex : fichier en plusieurs parties via edit_file).'
          }))
          this.history.push({ role: 'tool', results })
          continue
        }

        item.toolCalls = turn.toolCalls.map((c) => ({ id: c.id, name: c.name, input: c.input, status: 'pending' }))
        this.emit({ type: 'assistant-item', runId, item })

        const results = await this.runTools(runId, item, turn.toolCalls, signal)
        this.history.push({ role: 'tool', results })
        this.emit({ type: 'files-changed', projectId: this.project.id })
        this.save()
      }
    } catch (err) {
      reason = 'erreur'
      this.emit({ type: 'error', runId, message: friendlyError(err) })
      const errItem: ChatItem = { id: randomUUID(), role: 'system', text: '⚠ ' + friendlyError(err), createdAt: Date.now() }
      this.items.push(errItem)
    } finally {
      if (blocker !== null) powerSaveBlocker.stop(blocker)
      this.repairHistory()
      this.activeRun = null
      this.running = false
      this.abort = null
      this.save()
      this.emit({ type: 'done', runId, reason })
    }
  }

  /** Exécute les outils : lectures en parallèle, écritures/commandes en séquence. */
  private async runTools(runId: string, item: ChatItem, calls: ToolCall[], signal: AbortSignal): Promise<ToolResult[]> {
    const mode = loadSettings().approvalMode
    const results: ToolResult[] = new Array(calls.length)

    const runOne = async (call: ToolCall, idx: number): Promise<void> => {
      const view = item.toolCalls![idx]
      const update = (patch: Partial<ToolCallView>): void => {
        Object.assign(view, patch)
        this.emit({ type: 'tool-update', runId, itemId: item.id, call: { ...view } })
      }
      const tool = toolByName(call.name)
      if (!tool || call.invalid) {
        const msg = !tool
          ? `Outil inconnu "${call.name}". Outils disponibles : ${toolSchemas().map((t) => t.name).join(', ')}`
          : 'Arguments JSON invalides ou tronqués. Renvoie un appel avec un JSON valide.'
        update({ status: 'error', output: msg })
        results[idx] = { id: call.id, name: call.name, content: msg, isError: true }
        return
      }
      const invalid = validateInput(tool.schema, call.input)
      if (invalid) {
        update({ status: 'error', output: invalid })
        results[idx] = { id: call.id, name: call.name, content: invalid, isError: true }
        return
      }

      const needsApproval = (mode === 'ask-commands' && tool.risk === 'exec') || (mode === 'ask-all' && tool.risk !== 'read')
      if (needsApproval) {
        update({ status: 'awaiting-approval' })
        this.emit({ type: 'approval-request', runId, callId: call.id, name: call.name, input: call.input })
        const ok = await new Promise<boolean>((resolve) => this.approvals.set(call.id, resolve))
        if (!ok) {
          update({ status: 'denied', output: "Refusé par l'utilisateur" })
          results[idx] = { id: call.id, name: call.name, content: "L'utilisateur a refusé cette action. Propose une alternative.", isError: true }
          return
        }
      }

      update({ status: 'running', output: '' })
      let live = ''
      let lastFlush = 0
      try {
        const out = await tool.run(call.input, {
          project: this.project,
          root: this.project.path,
          signal,
          onOutput: (chunk) => {
            live = (live + chunk).slice(-20_000)
            const now = Date.now()
            if (now - lastFlush > 250) {
              lastFlush = now
              update({ output: live })
            }
          },
          onStatus: (message) => this.emit({ type: 'status', runId, message })
        })
        update({ status: 'done', output: clip(out, 20_000) })
        results[idx] = { id: call.id, name: call.name, content: out }
      } catch (err) {
        const msg = (err as Error).message ?? String(err)
        update({ status: 'error', output: msg })
        results[idx] = { id: call.id, name: call.name, content: `Erreur: ${msg}`, isError: true }
      }
    }

    // Lectures concurrentes, le reste dans l'ordre
    const reads = calls.map((c, i) => [c, i] as const).filter(([c]) => toolByName(c.name)?.risk === 'read')
    await Promise.all(reads.map(([c, i]) => runOne(c, i)))
    for (let i = 0; i < calls.length; i++) {
      if (results[i]) continue
      if (signal.aborted) {
        results[i] = { id: calls[i].id, name: calls[i].name, content: 'Annulé', isError: true }
        continue
      }
      await runOne(calls[i], i)
    }
    return results
  }

  /**
   * Compaction simple : si l'historique dépasse le budget, on raccourcit les anciens
   * résultats d'outils (les 8 derniers messages restent intacts). Les blocs natifs
   * (thinking) des messages modifiés sont abandonnés pour rester cohérent.
   */
  private compact(budgetChars: number, providerId: string): void {
    const size = (): number => JSON.stringify(this.history).length
    if (size() < budgetChars) return
    const keepFrom = Math.max(0, this.history.length - 8)
    for (let i = 0; i < keepFrom && size() > budgetChars * 0.7; i++) {
      const m = this.history[i]
      if (m.role === 'tool') {
        m.results = m.results.map((r) => (r.content.length > 400 ? { ...r, content: r.content.slice(0, 300) + '\n…[ancien résultat raccourci]' } : r))
      } else if (m.role === 'assistant') {
        if (m.native?.providerId === providerId) delete m.native
        m.toolCalls = m.toolCalls.map((c) => {
          const s = JSON.stringify(c.input)
          return s.length > 1500 ? { ...c, input: { _resume: s.slice(0, 600) + '…[raccourci]' } } : c
        })
      }
    }
    // Dernier recours : supprimer les plus anciens échanges en gardant le premier message utilisateur
    while (size() > budgetChars && this.history.length > 10) {
      this.history.splice(1, 2)
      while (this.history[1] && this.history[1].role === 'tool') this.history.splice(1, 1)
    }
  }

  /** Garantit qu'un appel d'outil a toujours son résultat (après arrêt brutal). */
  private repairHistory(): void {
    const last = this.history[this.history.length - 1]
    if (last?.role === 'assistant' && last.toolCalls.length) {
      this.history.push({
        role: 'tool',
        results: last.toolCalls.map((c) => ({ id: c.id, name: c.name, content: 'Interrompu', isError: true }))
      })
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(t)
      resolve()
    })
  })
}

function friendlyError(err: unknown): string {
  const msg = (err as Error)?.message ?? String(err)
  if (/ECONNREFUSED.*(11434|1234)/.test(msg)) return 'Le serveur IA local ne répond pas. Lancez Ollama ou le serveur de LM Studio, puis réessayez.'
  if (/401|invalid.*api.*key|authentication/i.test(msg)) return 'Clé API invalide ou manquante pour ce fournisseur (Réglages → Fournisseurs).'
  if (/context|too long|maximum context/i.test(msg)) return 'Contexte trop long pour ce modèle. Augmentez la fenêtre de contexte (Ollama : OLLAMA_CONTEXT_LENGTH, LM Studio : Context Length) ou videz la conversation.'
  return msg
}
