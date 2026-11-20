import { useEffect, useState } from 'react'
import { Copy, RefreshCw } from 'lucide-react'
import type { AppSettings } from '@shared/types'
import { LOCAL_MODELS, FIT_LABEL, assess, recommend, type Fit, type MachineInfo } from '@shared/localModels'
import { actions } from '../../store/appStore'
import { IconButton, Spinner } from '../ui'

const CONTEXT_VAR = 'OLLAMA_CONTEXT_LENGTH=32768'

const copy = (text: string): void => {
  navigator.clipboard.writeText(text).then(() => actions.toast(`Copié : ${text}`, 'success'))
}

/** Le tag Ollama peut être listé avec ou sans « :latest » */
const hasModel = (list: string[], tag: string): boolean => list.some((m) => m === tag || m === `${tag}:latest`)

const RANK: Record<Fit, number> = { gpu: 0, 'cpu-fast': 1, 'cpu-slow': 2, 'too-big': 3 }

interface Pull {
  procId: string
  line: string
  done?: boolean
  error?: boolean
}

export function LocalModels({ settings, onChange }: { settings: AppSettings; onChange: (s: AppSettings) => void }) {
  const [info, setInfo] = useState<MachineInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [pulls, setPulls] = useState<Record<string, Pull>>({})

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      setInfo(await window.api.local.info())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  // Progression des téléchargements : dernière ligne utile de « ollama pull »
  useEffect(
    () =>
      window.api.proc.onEvent((e) => {
        setPulls((prev) => {
          const entry = Object.entries(prev).find(([, p]) => p.procId === (e.type === 'output' ? e.id : e.info.id))
          if (!entry) return prev
          const [tag, p] = entry
          if (e.type === 'output') {
            const line = e.chunk.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean).pop()
            return line ? { ...prev, [tag]: { ...p, line } } : prev
          }
          if (e.info.status === 'running') return prev
          const ok = e.info.exitCode === 0
          if (ok) {
            actions.toast(`${tag} installé`, 'success')
            void load()
          }
          return { ...prev, [tag]: { ...p, done: true, error: !ok, line: ok ? '' : p.line || 'Échec du téléchargement' } }
        })
      }),
    []
  )

  const pull = async (tag: string): Promise<void> => {
    const r = await window.api.local.pull(tag)
    if (!r.ok || !r.proc) return actions.toast(r.error ?? 'Téléchargement impossible', 'error')
    setPulls((prev) => ({ ...prev, [tag]: { procId: r.proc!.id, line: 'Connexion…' } }))
  }

  const use = async (tag: string): Promise<void> => {
    onChange(await window.api.local.use(tag))
    actions.toast(`Fournisseur actif : Ollama · ${tag}`, 'success')
  }

  if (loading && !info) {
    return (
      <div className="lm-loading">
        <Spinner size={14} /> Analyse de la machine…
      </div>
    )
  }
  if (!info) return null

  const active = settings.providers.find((p) => p.id === settings.activeProviderId)
  const best = recommend(info)
  const rows = [...LOCAL_MODELS].sort(
    (a, b) => Number(b.id === best?.id) - Number(a.id === best?.id) || RANK[assess(a, info)] - RANK[assess(b, info)]
  )
  const gpu = info.unifiedMemory
    ? 'mémoire unifiée'
    : info.gpus.map((g) => `${g.name}${g.vramGB ? ` (${g.vramGB} Go)` : ''}`).join(', ') || 'aucun GPU détecté'

  return (
    <div className="lm">
      <dl className="lm-machine">
        <div>
          <dt>Mémoire</dt>
          <dd>{info.ramGB} Go</dd>
        </div>
        <div>
          <dt>Processeur</dt>
          <dd title={info.cpu}>{info.cores} cœurs</dd>
        </div>
        <div>
          <dt>GPU</dt>
          <dd>{gpu}</dd>
        </div>
        <div>
          <dt>Ollama</dt>
          <dd className={info.ollama.running ? 'ok' : ''}>
            {info.ollama.running ? `actif, ${info.ollama.models.length} modèle(s)` : info.ollama.installed ? 'arrêté' : 'non installé'}
          </dd>
        </div>
        <div>
          <dt>LM Studio</dt>
          <dd className={info.lmstudio.running ? 'ok' : ''}>{info.lmstudio.running ? 'serveur actif' : 'serveur arrêté'}</dd>
        </div>
        <IconButton icon={RefreshCw} label="Actualiser" size={13} disabled={loading} onClick={() => void load()} className="lm-refresh" />
      </dl>

      {!info.ollama.installed && (
        <p className="lm-note">
          Ollama n’est pas installé : le téléchargement en un clic est désactivé.{' '}
          <button className="link-btn" onClick={() => window.api.util.openExternal('https://ollama.com/download')}>
            Télécharger Ollama
          </button>{' '}
          ou utilisez LM Studio avec le nom indiqué sous chaque modèle.
        </p>
      )}

      <table className="lm-table">
        <thead>
          <tr>
            <th>Modèle</th>
            <th className="num">Taille</th>
            <th className="num">RAM min.</th>
            <th>Cette machine</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const fit = assess(m, info)
            const installed = hasModel(info.ollama.models, m.ollama)
            const isActive = active?.kind === 'ollama' && active.model === m.ollama
            const p = pulls[m.ollama]
            const pulling = !!p && !p.done
            return (
              <tr key={m.id} className={fit === 'too-big' ? 'dim' : ''}>
                <td>
                  <div className="lm-name">
                    {m.name}
                    {best?.id === m.id && <span className="lm-tag">Conseillé</span>}
                    {isActive && <span className="lm-tag active">Actif</span>}
                  </div>
                  <div className="lm-sub">{m.summary}</div>
                  <div className="lm-ids">
                    <span>
                      ollama <code>{m.ollama}</code>
                    </span>
                    <button className="lm-copy" onClick={() => copy(m.lmstudio)} title="Copier le nom à chercher dans LM Studio">
                      lm studio <code>{m.lmstudio}</code> <Copy size={10} />
                    </button>
                  </div>
                  {(pulling || p?.error) && <div className={`lm-progress${p?.error ? ' error' : ''}`}>{p?.line}</div>}
                </td>
                <td className="num">{m.sizeGB.toLocaleString('fr-FR')} Go</td>
                <td className="num">{m.minRamGB} Go</td>
                <td>
                  <span className={`lm-fit ${fit}`}>{FIT_LABEL[fit]}</span>
                </td>
                <td className="lm-action">
                  {pulling ? (
                    <Spinner size={12} />
                  ) : installed ? (
                    !isActive && (
                      <button className="btn small" onClick={() => void use(m.ollama)}>
                        Utiliser
                      </button>
                    )
                  ) : (
                    <button
                      className="btn small ghost"
                      disabled={!info.ollama.installed || fit === 'too-big'}
                      onClick={() => void pull(m.ollama)}
                      title={fit === 'too-big' ? 'Mémoire insuffisante sur cette machine' : !info.ollama.installed ? 'Ollama requis' : undefined}
                    >
                      Installer
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <p className="lm-note">
        L’agent a besoin d’un contexte d’au moins 32 768 tokens. Ollama :{' '}
        <button className="lm-copy" onClick={() => copy(CONTEXT_VAR)} title="Copier">
          <code>{CONTEXT_VAR}</code> <Copy size={10} />
        </button>{' '}
        puis redémarrer le service. LM Studio : « Context Length » au chargement du modèle. Tailles en quantification Q4, approximatives.
      </p>
    </div>
  )
}
