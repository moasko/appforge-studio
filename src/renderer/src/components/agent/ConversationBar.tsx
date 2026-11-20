import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, MessageSquare, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { ConversationMeta, UsageTotals } from '@shared/types'
import { formatCost, formatTokens } from '@shared/pricing'
import { IconButton, Spinner } from '../ui'

function ago(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return 'à l’instant'
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`
  const d = Math.floor(s / 86400)
  return d === 1 ? 'hier' : `il y a ${d} j`
}

export function UsageBadge({ usage }: { usage: UsageTotals }) {
  if (!usage.input && !usage.output) return null
  const tip = [
    `Entrée : ${usage.input.toLocaleString('fr-FR')} tokens`,
    usage.cacheRead ? `Lus depuis le cache : ${usage.cacheRead.toLocaleString('fr-FR')}` : '',
    usage.cacheWrite ? `Écrits en cache : ${usage.cacheWrite.toLocaleString('fr-FR')}` : '',
    `Sortie : ${usage.output.toLocaleString('fr-FR')} tokens`,
    usage.cost === null ? 'Coût : tarif inconnu pour ce modèle' : `Coût estimé : ${formatCost(usage.cost)}`
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <span className="usage-badge" data-tip={tip}>
      {formatTokens(usage.input + usage.cacheRead + usage.cacheWrite)} → {formatTokens(usage.output)}
      {usage.cost !== null && <b>{formatCost(usage.cost)}</b>}
    </span>
  )
}

interface Props {
  conversations: ConversationMeta[]
  activeId: string | null
  usage: UsageTotals
  running: boolean
  onSelect: (id: string) => void
  onCreate: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}

/** En-tête du panneau agent : conversation active, liste des autres, consommation. */
export function ConversationBar({ conversations, activeId, usage, running, onSelect, onCreate, onRename, onDelete }: Props) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const active = conversations.find((c) => c.id === activeId)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const commit = (id: string): void => {
    if (draft.trim()) onRename(id, draft.trim())
    setEditing(null)
  }

  return (
    <div className="conv-bar" ref={box}>
      <button className="conv-current" onClick={() => setOpen(!open)} aria-expanded={open}>
        <MessageSquare size={13} />
        <span className="conv-title">{active?.title ?? 'Nouvelle conversation'}</span>
        {conversations.length > 1 && <span className="conv-count">{conversations.length}</span>}
        <ChevronDown size={13} />
      </button>
      <div className="grow" />
      <UsageBadge usage={usage} />
      <IconButton icon={Plus} label="Nouvelle conversation" shortcut="Ctrl+Shift+N" size={14} onClick={onCreate} />

      {open && (
        <div className="conv-menu">
          <div className="conv-menu-head">
            <span>Conversations du projet</span>
            <button className="btn ghost small" onClick={() => (onCreate(), setOpen(false))}>
              <Plus size={12} /> Nouvelle
            </button>
          </div>
          <ul>
            {conversations.map((c) => (
              <li key={c.id} className={c.id === activeId ? 'active' : ''}>
                {editing === c.id ? (
                  <div className="conv-edit">
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commit(c.id)
                        if (e.key === 'Escape') setEditing(null)
                      }}
                    />
                    <IconButton icon={Check} label="Renommer" size={13} onClick={() => commit(c.id)} />
                    <IconButton icon={X} label="Annuler" size={13} onClick={() => setEditing(null)} />
                  </div>
                ) : (
                  <button
                    className="conv-item"
                    onClick={() => {
                      onSelect(c.id)
                      setOpen(false)
                    }}
                  >
                    <span className="conv-item-title">
                      {c.running && <Spinner size={9} />}
                      {c.title}
                    </span>
                    <span className="conv-item-meta">
                      {ago(c.updatedAt)}
                      {c.usage.cost ? ` · ${formatCost(c.usage.cost)}` : ''}
                    </span>
                  </button>
                )}
                {editing !== c.id && (
                  <span className="conv-actions">
                    <IconButton
                      icon={Pencil}
                      label="Renommer"
                      size={12}
                      onClick={() => {
                        setDraft(c.title)
                        setEditing(c.id)
                      }}
                    />
                    <IconButton
                      icon={Trash2}
                      label="Supprimer"
                      size={12}
                      disabled={c.running || (running && c.id === activeId)}
                      onClick={() => {
                        if (confirm(`Supprimer « ${c.title} » ? Le code n’est pas touché.`)) onDelete(c.id)
                      }}
                    />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
