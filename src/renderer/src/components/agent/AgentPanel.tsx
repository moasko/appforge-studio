import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowUp,
  Square,
  Sparkles,
  Bug,
  Rocket,
  Smartphone,
  LayoutGrid,
  Settings2,
  ListChecks,
  CircleCheck,
  Circle,
  Loader2,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Brain,
  Hexagon,
  ImagePlus,
  X,
  Undo2,
  FileDiff,
  Play,
  ClipboardList
} from 'lucide-react'
import type { AgentEvent, AgentMode, ChatItem, ConversationMeta, ImageAttachment, Project } from '@shared/types'
import { EMPTY_USAGE } from '@shared/types'
import { actions, getState, setState, useStore } from '../../store/appStore'
import { Markdown } from '../Markdown'
import { ToolCallCard } from './ToolCallCard'
import { ConversationBar } from './ConversationBar'
import { IconButton, Kbd } from '../ui'
import { formatElapsed, useElapsed } from '../../lib/time'
import { addImages, imageSrc } from '../../lib/images'

const SUGGESTIONS = [
  { icon: LayoutGrid, text: 'Ajoute un écran de profil avec photo et modification du nom' },
  { icon: Bug, text: 'Vérifie tout le projet (types, bundling, API) et corrige les erreurs' },
  { icon: Smartphone, text: 'Lance l’API et Expo pour que je teste sur mon téléphone' },
  { icon: Rocket, text: 'Prépare un APK Android installable' }
]

const EXECUTE_PLAN = 'Le plan est validé. Exécute-le étape par étape, puis vérifie (typecheck, endpoints, interface) et fais le résumé final.'

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

const convKey = (projectId: string): string => `conv:${projectId}`
const rememberConv = (projectId: string, id: string): void => {
  try {
    localStorage.setItem(convKey(projectId), id)
  } catch {
    /* stockage indisponible */
  }
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

/** Fichiers touchés pendant un tour, cliquables. */
function ChangedFiles({ files }: { files: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="changed-files">
      <button className="changed-head" onClick={() => setOpen(!open)}>
        <FileDiff size={12} />
        {files.length} fichier{files.length > 1 ? 's' : ''} modifié{files.length > 1 ? 's' : ''}
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open && (
        <ul>
          {files.slice(0, 200).map((f) => (
            <li key={f}>
              <button onClick={() => actions.openFile(f)}>{f}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Message utilisateur : texte, images, fichiers touchés, retour arrière. */
function UserTurn({ item, canRewind, onRewind }: { item: ChatItem; canRewind: boolean; onRewind: (restoreCode: boolean) => void }) {
  const [menu, setMenu] = useState(false)
  return (
    <div className="turn user">
      <div className="user-col">
        {item.mode === 'plan' && (
          <span className="mode-tag">
            <ClipboardList size={11} /> Plan
          </span>
        )}
        <div className="user-msg">
          {!!item.images?.length && (
            <div className="msg-images">
              {item.images.map((img, i) => (
                <img key={i} src={imageSrc(img)} alt={`Image jointe ${i + 1}`} />
              ))}
            </div>
          )}
          {item.text}
        </div>
        <div className="user-foot">
          {!!item.changedFiles?.length && <ChangedFiles files={item.changedFiles} />}
          {canRewind && (
            <div className="rewind">
              <button className="rewind-btn" onClick={() => setMenu(!menu)} data-tip="Revenir à ce message">
                <Undo2 size={12} /> Revenir ici
              </button>
              {menu && (
                <div className="rewind-menu" onMouseLeave={() => setMenu(false)}>
                  {item.checkpoint && (
                    <button
                      onClick={() => {
                        setMenu(false)
                        onRewind(true)
                      }}
                    >
                      <b>Restaurer le code et la conversation</b>
                      <span>Les fichiers reviennent à leur état d’avant ce message.</span>
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setMenu(false)
                      onRewind(false)
                    }}
                  >
                    <b>Conversation seulement</b>
                    <span>Le code reste tel quel ; le message revient dans la saisie.</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function AgentPanel({ project }: { project: Project }) {
  const settings = useStore((s) => s.settings)
  const convId = useStore((s) => s.conversationId)
  const usage = useStore((s) => s.usage)
  const running = useStore((s) => s.agentRunning && s.agentConversationId === s.conversationId && s.agentProjectId === project.id)
  const startedAt = useStore((s) => s.agentStartedAt)
  const elapsed = useElapsed(running ? startedAt : null)
  const pending = useStore((s) => s.pendingPrompt)
  const [conversations, setConversations] = useState<ConversationMeta[]>([])
  const [items, setItems] = useState<ChatItem[]>([])
  const [input, setInput] = useState('')
  const [images, setImages] = useState<ImageAttachment[]>([])
  const [mode, setMode] = useState<AgentMode>('build')
  const [dragging, setDragging] = useState(false)
  const [plan, setPlan] = useState<PlanItem[]>([])
  const [planOpen, setPlanOpen] = useState(true)
  const [status, setStatus] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const refreshList = useCallback(async (): Promise<ConversationMeta[]> => {
    const list = await window.api.conversations.list(project.id)
    setConversations(list)
    return list
  }, [project.id])

  const createConversation = useCallback(async (): Promise<void> => {
    // Inutile d'empiler des conversations vides
    const empty = conversations.find((c) => c.id === getState().conversationId && !c.usage.input && !items.length)
    if (empty) return inputRef.current?.focus()
    const c = await window.api.conversations.create(project.id)
    rememberConv(project.id, c.id)
    setState({ conversationId: c.id })
    await refreshList()
    inputRef.current?.focus()
  }, [project.id, conversations, items.length, refreshList])

  // Projet ouvert : on reprend la dernière conversation utilisée (ou on en crée une)
  useEffect(() => {
    let alive = true
    refreshList().then(async (list) => {
      if (!alive) return
      let saved: string | null = null
      try {
        saved = localStorage.getItem(convKey(project.id))
      } catch {
        /* ignore */
      }
      const pick = list.find((c) => c.running) ?? list.find((c) => c.id === saved) ?? list[0]
      const id = pick ? pick.id : (await window.api.conversations.create(project.id)).id
      if (!pick) await refreshList()
      if (alive) setState({ conversationId: id })
    })
    return () => {
      alive = false
    }
  }, [project.id, refreshList])

  // Conversation affichée : historique + événements en direct
  useEffect(() => {
    if (!convId) return
    rememberConv(project.id, convId)
    setItems([])
    setPlan([])
    setStatus('')
    window.api.agent.history(project.id, convId).then((h) => {
      if (getState().conversationId !== convId) return
      setItems(h.items)
      setState({ usage: h.usage ?? EMPTY_USAGE })
      if (h.running) setState({ agentRunning: true, agentStartedAt: h.startedAt, agentProjectId: project.id, agentConversationId: convId })
    })
    const off = window.api.agent.onEvent((e) => {
      if (e.projectId !== project.id) return
      if (e.type === 'start' || e.type === 'done') void refreshList()
      if (e.conversationId === convId) handle(e)
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, convId])

  useEffect(() => {
    const focus = (): void => inputRef.current?.focus()
    const create = (): void => void createConversation()
    window.addEventListener('focus-composer', focus)
    window.addEventListener('new-conversation', create)
    return () => {
      window.removeEventListener('focus-composer', focus)
      window.removeEventListener('new-conversation', create)
    }
  }, [createConversation])

  useEffect(() => {
    if (pending && convId && !getState().agentRunning) {
      setState({ pendingPrompt: null })
      send(pending, { mode: 'build', images: [] })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, convId])

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
        setState({ agentRunning: true, agentStartedAt: e.startedAt, agentProjectId: project.id, agentConversationId: convId })
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
        setState({ usage: e.usage })
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
        setState({ agentRunning: false, agentStartedAt: null, agentProjectId: null, agentConversationId: null })
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

  const send = async (text: string, override?: { mode: AgentMode; images: ImageAttachment[] }): Promise<void> => {
    const t = text.trim()
    const imgs = override?.images ?? images
    const m = override?.mode ?? mode
    if ((!t && !imgs.length) || !convId) return
    stick.current = true
    const r = await window.api.agent.send(project.id, convId, t || 'Reproduis fidèlement cette interface dans l’app.', { mode: m, images: imgs })
    if (!r.ok) return actions.toast(r.error ?? 'Erreur', 'error')
    if (!override) {
      setInput('')
      setImages([])
      if (inputRef.current) inputRef.current.style.height = 'auto'
    }
    if (m === 'plan') setMode('build')
  }

  const attach = async (files: Iterable<File>): Promise<void> => {
    const r = await addImages(images, files)
    setImages(r.images)
    r.errors.forEach((msg) => actions.toast(msg, 'error'))
  }

  const rewind = async (item: ChatItem, restoreCode: boolean): Promise<void> => {
    if (!convId) return
    if (restoreCode && !confirm('Remettre les fichiers du projet dans leur état d’avant ce message ? (un point de restauration de l’état actuel est gardé)')) return
    const r = await window.api.agent.rewind(project.id, convId, item.id, restoreCode)
    if (!r.ok) return actions.toast(r.error ?? 'Retour arrière impossible', 'error')
    const h = await window.api.agent.history(project.id, convId)
    setItems(h.items)
    setPlan([])
    setInput(r.text ?? '')
    setImages(r.images ?? [])
    setMode(r.mode ?? 'build')
    inputRef.current?.focus()
    if (r.files) {
      actions.toast(`Code restauré : ${r.files.restored} fichier(s) remis, ${r.files.removed} supprimé(s)`, 'success')
      actions.refreshTree()
    } else actions.toast('Conversation ramenée avant ce message', 'success')
    if (r.historyCut === false) actions.toast('Ce message était déjà résumé dans le contexte du modèle : seul l’affichage a été coupé.')
  }

  const provider = settings?.providers.find((p) => p.id === settings.activeProviderId)
  const done = plan.filter((p) => p.status === 'done').length
  const lastUser = [...items].reverse().find((i) => i.role === 'user')
  const lastAssistant = [...items].reverse().find((i) => i.role === 'assistant' && i.text)
  const showExecutePlan =
    !running && lastUser?.mode === 'plan' && !!lastAssistant && items.indexOf(lastAssistant) > items.indexOf(lastUser)

  return (
    <div className="agent">
      <ConversationBar
        conversations={conversations}
        activeId={convId}
        usage={usage}
        running={running}
        onSelect={(id) => setState({ conversationId: id })}
        onCreate={() => void createConversation()}
        onRename={async (id, title) => {
          await window.api.conversations.rename(project.id, id, title)
          refreshList()
        }}
        onDelete={async (id) => {
          const r = await window.api.conversations.remove(project.id, id)
          if (!r.ok) return actions.toast(r.error ?? 'Suppression impossible', 'error')
          const list = await refreshList()
          if (id === convId) {
            const next = list[0] ?? (await window.api.conversations.create(project.id))
            if (!list.length) await refreshList()
            setState({ conversationId: next.id })
          }
        }}
      />

      <div
        className="agent-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
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
                  <button key={s.text} className="suggestion" onClick={() => send(s.text, { mode, images: [] })}>
                    <s.icon size={15} />
                    <span>{s.text}</span>
                  </button>
                ))}
              </div>
              <p className="hero-tip">
                Astuce : collez une maquette ou une capture (<Kbd>Ctrl V</Kbd>) pour que l’agent reproduise l’écran, ou passez en mode{' '}
                <b>Plan</b> pour valider l’approche avant qu’il ne touche au code.
              </p>
              {!provider?.model && (
                <button className="btn primary" onClick={() => setState({ modal: 'settings' })}>
                  <Settings2 size={14} /> Configurer un modèle IA
                </button>
              )}
            </div>
          )}

          {items.map((it, idx) => {
            if (it.role === 'user')
              return <UserTurn key={it.id} item={it} canRewind={!running && !getState().agentRunning} onRewind={(code) => rewind(it, code)} />
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
                        <ToolCallCard key={c.id} call={c} onApprove={(ok) => convId && window.api.agent.approve(project.id, convId, c.id, ok)} />
                      ))}
                    </div>
                  )}
                  {showExecutePlan && it === lastAssistant && (
                    <div className="plan-actions">
                      <button className="btn primary" onClick={() => send(EXECUTE_PLAN, { mode: 'build', images: [] })}>
                        <Play size={13} /> Exécuter le plan
                      </button>
                      <button
                        className="btn ghost"
                        onClick={() => {
                          setMode('plan')
                          inputRef.current?.focus()
                        }}
                      >
                        Ajuster le plan
                      </button>
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

        <div
          className={`composer-box${running ? ' running' : ''}${dragging ? ' dragging' : ''}${mode === 'plan' ? ' plan-mode' : ''}`}
          onDragOver={(e) => {
            if (![...e.dataTransfer.items].some((i) => i.kind === 'file')) return
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            void attach(e.dataTransfer.files)
          }}
        >
          {!!images.length && (
            <div className="composer-images">
              {images.map((img, i) => (
                <div key={i} className="thumb">
                  <img src={imageSrc(img)} alt={`Pièce jointe ${i + 1}`} />
                  <button aria-label="Retirer l’image" onClick={() => setImages(images.filter((_, j) => j !== i))}>
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            placeholder={
              running
                ? 'L’agent travaille… Échap pour l’arrêter'
                : mode === 'plan'
                  ? 'Décrivez ce que vous voulez : l’agent explore et propose un plan, sans rien modifier'
                  : 'Décrivez une fonctionnalité, un bug, un déploiement… ou collez une maquette'
            }
            onChange={(e) => {
              setInput(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(220, e.target.scrollHeight) + 'px'
            }}
            onPaste={(e) => {
              const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
              if (!files.length) return
              e.preventDefault()
              void attach(files)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !running) {
                e.preventDefault()
                send(input)
              }
              if (e.key === 'Tab' && e.shiftKey) {
                e.preventDefault()
                setMode(mode === 'plan' ? 'build' : 'plan')
              }
              if (e.key === 'Escape' && running && convId) window.api.agent.stop(project.id, convId)
            }}
          />
          <div className="composer-tools">
            <div className="mode-switch" role="radiogroup" aria-label="Mode de l’agent" data-tip="Changer de mode  Maj+Tab">
              <button role="radio" aria-checked={mode === 'build'} className={mode === 'build' ? 'on' : ''} onClick={() => setMode('build')}>
                Agir
              </button>
              <button role="radio" aria-checked={mode === 'plan'} className={mode === 'plan' ? 'on' : ''} onClick={() => setMode('plan')}>
                <ClipboardList size={11} /> Plan
              </button>
            </div>
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
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) void attach(e.target.files)
                e.target.value = ''
              }}
            />
            <IconButton icon={ImagePlus} label="Joindre une image (ou coller / glisser)" size={15} onClick={() => fileRef.current?.click()} />
            <span className="composer-hint">
              <Kbd>↵</Kbd> envoyer
            </span>
            {running ? (
              <button className="send-btn stop" onClick={() => convId && window.api.agent.stop(project.id, convId)} data-tip="Arrêter  Échap">
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <button
                className="send-btn"
                disabled={!input.trim() && !images.length}
                onClick={() => send(input)}
                data-tip={mode === 'plan' ? 'Demander un plan' : 'Envoyer'}
              >
                <ArrowUp size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
