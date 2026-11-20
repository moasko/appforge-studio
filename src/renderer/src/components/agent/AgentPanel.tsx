import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Square, Eraser, Sparkles, Bug, Rocket, Smartphone, LayoutGrid, Settings2, ListChecks, CircleCheck, Circle, Loader2, ChevronDown, ChevronUp, ChevronRight, Brain, Hexagon } from 'lucide-react'
import type { AgentEvent, ChatItem, Project } from '@shared/types'
import { actions, getState, setState, useStore } from '../../store/appStore'
import { Markdown } from '../Markdown'
import { ToolCallCard } from './ToolCallCard'
import { IconButton, Kbd } from '../ui'
import { formatElapsed, useElapsed } from '../../lib/time'

const SUGGESTIONS = [
  { icon: LayoutGrid, text: 'Ajoute un écran de profil avec photo et modification du nom' },
  { icon: Bug, text: 'Vérifie tout le projet (types, bundling, API) et corrige les erreurs' },
  { icon: Smartphone, text: 'Lance l’API et Expo pour que je teste sur mon téléphone' },
  { icon: Rocket, text: 'Prépare un APK Android installable' }
]

interface PlanItem {
  text: string
  status: 'done' | 'doing' | 'todo'
}

function parsePlan(s: string): PlanItem[] {
  return s
    .split('\n')
    .filter(Boolean)
    .map((l) => ({
      status: l.startsWith('✅') ? 'done' : l.startsWith('⏳') ? 'doing' : 'todo',
      text: l.replace(/^[✅⏳⬜]\s*/u, '')
    }))
}

/** Raisonnement du modèle : ouvert pendant le flux, replié dans l'historique. */
function ReasoningBlock({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(live)
  const wasLive = useRef(live)
  useEffect(() => {
    if (live && !wasLive.current) setOpen(true)
    wasLive.current = live
  }, [live])
  return (
    <div className={`reasoning${live ? ' live' : ''}`}>
      <button className="reasoning-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Brain size={12} />
        <span className={live ? 'shimmer' : ''}>{live ? 'Réflexion en cours…' : 'Réflexion'}</span>
      </button>
      {open && <div className="reasoning-body">{text}</div>}
    </div>
  )
}

export function AgentPanel({ project }: { project: Project }) {
  const settings = useStore((s) => s.settings)
  const running = useStore((s) => s.agentRunning)
  const startedAt = useStore((s) => s.agentStartedAt)
  const elapsed = useElapsed(running ? startedAt : null)
  const pending = useStore((s) => s.pendingPrompt)
  const [items, setItems] = useState<ChatItem[]>([])
  const [input, setInput] = useState('')
  const [plan, setPlan] = useState<PlanItem[]>([])
  const [planOpen, setPlanOpen] = useState(true)
  const [status, setStatus] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    window.api.agent.history(project.id).then((h) => {
      setItems(h.items)
      const cur = getState()
      if (h.running) setState({ agentRunning: true, agentStartedAt: h.startedAt, agentProjectId: project.id })
      else if (!cur.agentRunning || cur.agentProjectId === project.id) setState({ agentRunning: false, agentStartedAt: null, agentProjectId: null })
    })
    const off = window.api.agent.onEvent((e) => e.projectId === project.id && handle(e))
    const focus = (): void => inputRef.current?.focus()
    window.addEventListener('focus-composer', focus)
    return () => {
      off()
      window.removeEventListener('focus-composer', focus)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id])

  useEffect(() => {
    if (pending && !getState().agentRunning) {
      setState({ pendingPrompt: null })
      send(pending)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])

  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [items, running])

  const upsert = (item: ChatItem): void =>
    setItems((prev) => {
      const i = prev.findIndex((x) => x.id === item.id)
      if (i === -1) return [...prev, item]
      const next = [...prev]
      next[i] = { ...item }
      return next
    })

  const handle = (e: AgentEvent): void => {
    switch (e.type) {
      case 'start':
        setState({ agentRunning: true, agentStartedAt: e.startedAt })
        setStatus('')
        break
      case 'assistant-item':
        upsert(e.item)
        break
      case 'text-delta':
        setItems((prev) => prev.map((x) => (x.id === e.itemId ? { ...x, text: x.text + e.delta } : x)))
        break
      case 'reasoning-delta':
        setItems((prev) => prev.map((x) => (x.id === e.itemId ? { ...x, reasoning: (x.reasoning ?? '') + e.delta } : x)))
        break
      case 'tool-update':
        setItems((prev) => prev.map((x) => (x.id === e.itemId ? { ...x, toolCalls: (x.toolCalls ?? []).map((c) => (c.id === e.call.id ? e.call : c)) } : x)))
        break
      case 'status':
        if (/[✅⏳⬜]/u.test(e.message)) setPlan(parsePlan(e.message))
        else setStatus(e.message)
        break
      case 'usage':
        setState((s) => ({ tokens: { in: s.tokens.in + e.inputTokens, out: s.tokens.out + e.outputTokens } }))
        break
      case 'files-changed':
        actions.refreshTree()
        break
      case 'error':
        setItems((prev) => [...prev, { id: crypto.randomUUID(), role: 'system', text: e.message, createdAt: Date.now() }])
        actions.toast(e.message, 'error')
        break
      case 'done': {
        const started = getState().agentStartedAt
        setState({ agentRunning: false, agentStartedAt: null })
        setStatus(e.reason === 'terminé' ? '' : `Arrêt : ${e.reason}`)
        if (e.reason === 'terminé') {
          const took = started ? ` en ${formatElapsed(Date.now() - started)}` : ''
          actions.toast(`Tâche terminée${took}`, 'success')
        }
        actions.refreshTree()
        break
      }
    }
  }

  const send = async (text: string): Promise<void> => {
    const t = text.trim()
    if (!t) return
    stick.current = true
    const r = await window.api.agent.send(project.id, t)
    if (!r.ok) actions.toast(r.error ?? 'Erreur', 'error')
    else {
      setInput('')
      if (settings?.approvalMode && settings.approvalMode !== 'autopilot') {
        actions.toast('Mode non surveillé impossible : l’agent attendra vos approbations (passez en Autopilot).')
      }
    }
  }

  const provider = settings?.providers.find((p) => p.id === settings.activeProviderId)
  const done = plan.filter((p) => p.status === 'done').length

  return (
    <div className="agent">
      <div className="agent-scroll" ref={scroller} onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      }}>
        <div className="agent-thread">
          {!items.length && (
            <div className="agent-hero">
              <div className="hero-icon">
                <Sparkles size={22} />
              </div>
              <h2>Que construit-on aujourd’hui ?</h2>
              <p>L’agent code, teste, lance et déploie votre app mobile et son backend — en autonomie.</p>
              <div className="suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s.text} className="suggestion" onClick={() => send(s.text)}>
                    <s.icon size={15} />
                    <span>{s.text}</span>
                  </button>
                ))}
              </div>
              {!provider?.model && (
                <button className="btn primary" onClick={() => setState({ modal: 'settings' })}>
                  <Settings2 size={14} /> Configurer un modèle IA
                </button>
              )}
            </div>
          )}

          {items.map((it, idx) => {
            if (it.role === 'user')
              return (
                <div key={it.id} className="turn user">
                  <div className="user-msg">{it.text}</div>
                </div>
              )
            if (it.role === 'system')
              return (
                <div key={it.id} className="turn">
                  <div className="sys-msg">{it.text.replace(/^⚠\s*/, '')}</div>
                </div>
              )
            if (!it.text && !it.toolCalls?.length && !it.reasoning) return null
            return (
              <div key={it.id} className="turn assistant">
                <div className="assistant-rail">
                  <div className="assistant-avatar">
                    <Hexagon size={12} strokeWidth={2.2} />
                  </div>
                </div>
                <div className="assistant-body">
                  {!!it.reasoning && <ReasoningBlock text={it.reasoning} live={running && idx === items.length - 1} />}
                  {it.text && <Markdown text={it.text} />}
                  {!!it.toolCalls?.length && (
                    <div className="tool-timeline">
                      {it.toolCalls.map((c) => (
                        <ToolCallCard key={c.id} call={c} onApprove={(ok) => window.api.agent.approve(project.id, c.id, ok)} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {running && (
            <div className="thinking">
              <span className="shimmer">L’agent réfléchit…</span>
              {!!elapsed && <span className="thinking-time">{formatElapsed(elapsed)}</span>}
            </div>
          )}
        </div>
      </div>

      <div className="composer-wrap">
        {plan.length > 0 && (
          <div className="plan-card">
            <button className="plan-head" onClick={() => setPlanOpen(!planOpen)}>
              <ListChecks size={14} />
              <span>Plan</span>
              <span className="plan-count">
                {done}/{plan.length}
              </span>
              <div className="plan-progress">
                <div style={{ width: `${(done / plan.length) * 100}%` }} />
              </div>
              {planOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
            {planOpen && (
              <ul className="plan-list">
                {plan.map((p, i) => (
                  <li key={i} className={p.status}>
                    {p.status === 'done' ? <CircleCheck size={13} /> : p.status === 'doing' ? <Loader2 size={13} className="spin" /> : <Circle size={13} />}
                    {p.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {status && <div className="agent-status">{status}</div>}

        <div className={`composer-box${running ? ' running' : ''}`}>
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            placeholder={running ? 'L’agent travaille… Échap pour l’arrêter' : 'Décrivez une fonctionnalité, un bug, un déploiement…'}
            onChange={(e) => {
              setInput(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(220, e.target.scrollHeight) + 'px'
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !running) {
                e.preventDefault()
                send(input)
              }
              if (e.key === 'Escape' && running) window.api.agent.stop(project.id)
            }}
          />
          <div className="composer-tools">
            <select
              className="chip-select"
              value={settings?.activeProviderId ?? ''}
              onChange={(e) => actions.saveSettings({ activeProviderId: e.target.value })}
            >
              {settings?.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.model || '—'}
                </option>
              ))}
            </select>
            <select
              className="chip-select"
              value={settings?.approvalMode}
              onChange={(e) => actions.saveSettings({ approvalMode: e.target.value as 'autopilot' })}
            >
              <option value="autopilot">Autopilot</option>
              <option value="ask-commands">Valider commandes</option>
              <option value="ask-all">Tout valider</option>
            </select>
            <div className="grow" />
            <IconButton
              icon={Eraser}
              label="Nouvelle conversation"
              size={14}
              disabled={running}
              onClick={async () => {
                if (!confirm('Effacer la conversation ? Le code n’est pas touché.')) return
                await window.api.agent.clear(project.id)
                setItems([])
                setPlan([])
                setState({ tokens: { in: 0, out: 0 } })
              }}
            />
            <span className="composer-hint">
              <Kbd>↵</Kbd> envoyer
            </span>
            {running ? (
              <button className="send-btn stop" onClick={() => window.api.agent.stop(project.id)} data-tip="Arrêter  Échap">
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <button className="send-btn" disabled={!input.trim()} onClick={() => send(input)} data-tip="Envoyer">
                <ArrowUp size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
