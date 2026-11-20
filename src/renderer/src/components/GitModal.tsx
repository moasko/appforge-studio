import { useCallback, useEffect, useState } from 'react'
import { GitBranch, RotateCcw, Trash2 } from 'lucide-react'
import type { GitChange, GitStatus } from '@shared/types'
import { actions } from '../store/appStore'

const LABELS: Record<string, string> = {
  M: 'modifié',
  A: 'ajouté',
  D: 'supprimé',
  R: 'renommé',
  C: 'copié',
  U: 'conflit',
  '??': 'non suivi'
}

const label = (c: GitChange): string => LABELS[c.status] ?? LABELS[c.status[0]] ?? 'modifié'

function refreshAfterChange(): void {
  actions.refreshTree()
  window.dispatchEvent(new Event('git-changed'))
}

export function GitModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [info, setInfo] = useState<GitStatus | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setInfo(await window.api.git.status(projectId))
  }, [projectId])

  useEffect(() => {
    load()
  }, [load])

  const restore = async (change: GitChange): Promise<void> => {
    if (!confirm(`Annuler les modifications de « ${change.path} » ? Cette action est irréversible.`)) return
    setBusy(true)
    const r = await window.api.git.restore(projectId, [change.path])
    setBusy(false)
    if (!r.ok) return actions.toast(r.error ?? 'Échec de la restauration', 'error')
    actions.toast(`${change.path} restauré`, 'success')
    refreshAfterChange()
    load()
  }

  const clean = async (change: GitChange): Promise<void> => {
    if (!confirm(`Supprimer définitivement le nouveau fichier « ${change.path} » ?`)) return
    setBusy(true)
    const r = await window.api.git.clean(projectId, [change.path])
    setBusy(false)
    if (!r.ok) return actions.toast(r.error ?? 'Échec de la suppression', 'error')
    actions.toast(`${change.path} supprimé`, 'success')
    refreshAfterChange()
    load()
  }

  const tracked = info?.changes.filter((c) => c.tracked) ?? []

  const restoreAll = async (): Promise<void> => {
    if (!tracked.length) return
    if (!confirm(`Annuler les modifications de ${tracked.length} fichier(s) ? Cette action est irréversible.`)) return
    setBusy(true)
    const r = await window.api.git.restore(projectId, tracked.map((c) => c.path))
    setBusy(false)
    if (!r.ok) return actions.toast(r.error ?? 'Échec de la restauration', 'error')
    actions.toast('Modifications annulées', 'success')
    refreshAfterChange()
    load()
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>
          <GitBranch size={17} /> Modifications
        </h2>

        {!info && <div className="panel-empty">Chargement…</div>}

        {info && !info.repo && (
          <div className="panel-empty">Ce projet n’est pas un dépôt git : rien à suivre ni à annuler.</div>
        )}

        {info?.repo && (
          <>
            <div className="git-repo">
              <GitBranch size={12} /> {info.branch ?? 'DETACHED'}
              <span>·</span>
              {info.changes.length} fichier(s) modifié(s)
            </div>

            {info.changes.length ? (
              <div className="git-list">
                {info.changes.map((c) => (
                  <div key={c.path} className="git-row">
                    <span className="git-code">{c.status}</span>
                    <span className="git-path" title={c.path}>
                      {c.path}
                    </span>
                    <span className="git-label">{label(c)}</span>
                    <button
                      className={`btn ghost sm${c.tracked ? '' : ' danger'}`}
                      disabled={busy}
                      onClick={() => (c.tracked ? restore(c) : clean(c))}
                    >
                      {c.tracked ? <RotateCcw size={12} /> : <Trash2 size={12} />}
                      {c.tracked ? 'Restaurer' : 'Supprimer'}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="panel-empty">Aucune modification : tout est commité.</div>
            )}
          </>
        )}

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            Fermer
          </button>
          {tracked.length > 0 && (
            <button className="btn danger" disabled={busy} onClick={restoreAll}>
              Tout annuler
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
