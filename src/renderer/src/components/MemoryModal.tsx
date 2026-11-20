import { useCallback, useEffect, useState } from 'react'
import { Brain, Plus, Trash2 } from 'lucide-react'
import type { MemoryCategory, MemoryEntry } from '@shared/types'
import { MEMORY_CATEGORIES, MEMORY_LABELS } from '@shared/types'
import { actions } from '../store/appStore'

export function MemoryModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [entries, setEntries] = useState<MemoryEntry[] | null>(null)
  const [category, setCategory] = useState<MemoryCategory>('note')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setEntries(await window.api.memory.list(projectId))
  }, [projectId])

  useEffect(() => {
    load()
  }, [load])

  const add = async (): Promise<void> => {
    if (!text.trim()) return
    setBusy(true)
    await window.api.memory.add(projectId, category, text.trim())
    setBusy(false)
    setText('')
    actions.toast('Fait mémorisé', 'success')
    load()
  }

  const remove = async (e: MemoryEntry): Promise<void> => {
    if (!confirm('Supprimer définitivement ce fait de la mémoire du projet ?')) return
    await window.api.memory.remove(projectId, e.id)
    load()
  }

  const groups = MEMORY_CATEGORIES.map((c) => ({ category: c, items: (entries ?? []).filter((e) => e.category === c) })).filter(
    (g) => g.items.length
  )

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <h2>
          <Brain size={17} /> Mémoire du projet
        </h2>
        <p className="muted small">
          Faits durables injectés dans le contexte de l’agent à chaque tour (stockés dans <code>.appforge/memory.json</code>). L’agent les
          alimente lui-même avec l’outil <code>memory_save</code>.
        </p>

        <div className="mem-add">
          <select value={category} onChange={(e) => setCategory(e.target.value as MemoryCategory)}>
            {MEMORY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {MEMORY_LABELS[c]}
              </option>
            ))}
          </select>
          <input
            value={text}
            placeholder="Ex : API sur le port 3000, testée avec http_request le 19/11."
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button className="btn small" disabled={busy || !text.trim()} onClick={add}>
            <Plus size={13} /> Ajouter
          </button>
        </div>

        <div className="modal-body mem-body">
          {!entries && <div className="panel-empty">Chargement…</div>}
          {entries && !entries.length && (
            <div className="panel-empty">
              Mémoire vide. Elle sera initialisée automatiquement depuis <code>AGENTS.md</code> au prochain tour de l’agent.
            </div>
          )}
          {groups.map((g) => (
            <section key={g.category} className="mem-group">
              <h3>
                {MEMORY_LABELS[g.category]} <span className="muted small">· {g.items.length}</span>
              </h3>
              {g.items.map((e) => (
                <div key={e.id} className="mem-row">
                  <span className="mem-text" title={e.text}>
                    {e.text}
                  </span>
                  <button className="icon-btn mem-del" title="Supprimer" onClick={() => remove(e)}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </section>
          ))}
        </div>

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  )
}
