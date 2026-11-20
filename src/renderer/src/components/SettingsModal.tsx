import { useEffect, useState } from 'react'
import type { AppSettings, ModelInfo, ProviderConfig, ProviderKind } from '@shared/types'
import { PROVIDER_CATALOG } from '@shared/types'
import { LocalModels } from './settings/LocalModels'

type Tab = 'providers' | 'local' | 'general' | 'secrets' | 'env'

const KIND_LABEL: Record<ProviderKind, string> = {
  anthropic: 'Claude (Anthropic)',
  'anthropic-compatible': 'Passerelle compatible Anthropic',
  openai: 'OpenAI (ChatGPT)',
  'openai-compatible': 'API compatible OpenAI',
  lmstudio: 'LM Studio (local)',
  ollama: 'Ollama (local)',
  local: 'Serveur local compatible OpenAI'
}

const SECRET_HINTS: Record<string, string> = {
  EXPO_TOKEN: 'expo.dev → Account settings → Access tokens (builds EAS, OTA)',
  FLY_API_TOKEN: 'fly.io → Tokens (déploiement backend)',
  RAILWAY_TOKEN: 'railway.app → Project → Settings → Tokens',
  TURSO_API_TOKEN: 'turso.tech → Settings → API tokens (base de données)',
  VERCEL_TOKEN: 'vercel.com → Settings → Tokens (version web)',
  SSH_HOST: 'IP ou domaine de votre VPS',
  SSH_USER: 'Utilisateur SSH du VPS (clé SSH configurée sur ce PC)',
  GITHUB_TOKEN: 'github.com → Settings → Developer settings → Tokens'
}

export function SettingsModal({ settings, onChange, onClose }: { settings: AppSettings; onChange: (s: AppSettings) => void; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('providers')
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2>Réglages</h2>
          <button className="icon-btn" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="tabs inline">
          {(
            [
              ['providers', 'Fournisseurs IA'],
              ['local', 'Modèles locaux'],
              ['general', 'Général'],
              ['secrets', 'Secrets & déploiement'],
              ['env', 'Environnement']
            ] as [Tab, string][]
          ).map(([k, l]) => (
            <button key={k} className={'tab' + (tab === k ? ' active' : '')} onClick={() => setTab(k)}>
              {l}
            </button>
          ))}
        </div>
        <div className="modal-body">
          {tab === 'providers' && <Providers settings={settings} onChange={onChange} onLocal={() => setTab('local')} />}
          {tab === 'local' && <LocalModels settings={settings} onChange={onChange} />}
          {tab === 'general' && <General settings={settings} onChange={onChange} />}
          {tab === 'secrets' && <Secrets settings={settings} onChange={onChange} />}
          {tab === 'env' && <EnvCheck />}
        </div>
      </div>
    </div>
  )
}

function Providers({ settings, onChange, onLocal }: { settings: AppSettings; onChange: (s: AppSettings) => void; onLocal: () => void }) {
  const [editing, setEditing] = useState<ProviderConfig | null>(null)
  return (
    <div className="providers">
      <div className="provider-list">
        {settings.providers.map((p) => (
          <div key={p.id} className={'provider-row' + (editing?.id === p.id ? ' active' : '')} onClick={() => setEditing({ ...p })}>
            <div>
              <b>{p.name}</b> {settings.activeProviderId === p.id && <span className="badge done">actif</span>}
              <div className="muted small">
                {KIND_LABEL[p.kind]} · {p.model || 'aucun modèle'}
              </div>
            </div>
          </div>
        ))}
        <select
          value=""
          onChange={(e) => {
            const preset = PROVIDER_CATALOG.find((x) => x.id === e.target.value)
            if (!preset) return
            setEditing({
              id: '',
              name: preset.name,
              kind: preset.kind,
              baseUrl: preset.baseUrl,
              model: preset.model,
              toolMode: preset.toolMode,
              maxTokens: preset.maxTokens,
              effort: preset.effort
            })
          }}
        >
          <option value="">+ Ajouter un fournisseur…</option>
          {[...new Set(PROVIDER_CATALOG.map((p) => p.group))].map((group) => (
            <optgroup key={group} label={group}>
              {PROVIDER_CATALOG.filter((p) => p.group === group).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {editing ? (
        <ProviderForm
          key={editing.id || 'new'}
          initial={editing}
          isActive={settings.activeProviderId === editing.id}
          onSaved={(s) => {
            onChange(s)
            setEditing(null)
          }}
          onActivate={async (id) => onChange(await window.api.settings.save({ activeProviderId: id }))}
          onDelete={async (id) => {
            onChange(await window.api.settings.deleteProvider(id))
            setEditing(null)
          }}
        />
      ) : (
        <div className="muted small pad">
          Sélectionnez ou ajoutez un fournisseur.
          <br />
          <br />
          <b>Local et gratuit</b> : l’onglet{' '}
          <button className="link-btn" onClick={onLocal}>
            Modèles locaux
          </button>{' '}
          indique quels modèles conviennent à cette machine et les installe avec Ollama en un clic.
        </div>
      )}
    </div>
  )
}

function ProviderForm({
  initial,
  isActive,
  onSaved,
  onActivate,
  onDelete
}: {
  initial: ProviderConfig
  isActive: boolean
  onSaved: (s: AppSettings) => void
  onActivate: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [p, setP] = useState<ProviderConfig>({ ...initial, apiKey: '' })
  const [models, setModels] = useState<ModelInfo[]>([])
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof ProviderConfig>(k: K, v: ProviderConfig[K]): void => setP((x) => ({ ...x, [k]: v }))
  const needsKey =
    p.kind === 'anthropic' || p.kind === 'anthropic-compatible' || p.kind === 'openai' || p.kind === 'openai-compatible'

  const fetchModels = async (): Promise<void> => {
    setBusy(true)
    const r = await window.api.settings.listModels(p)
    setBusy(false)
    if (r.ok) {
      setModels(r.models)
      setMsg(`${r.models.length} modèle(s) trouvé(s)`)
      if (!p.model && r.models[0]) set('model', r.models[0].id)
    } else setMsg('Erreur : ' + r.error)
  }

  useEffect(() => {
    if (p.kind === 'ollama' || p.kind === 'lmstudio' || p.kind === 'local' || initial.hasApiKey) fetchModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="provider-form">
      <label>
        Nom
        <input value={p.name} onChange={(e) => set('name', e.target.value)} />
      </label>
      {p.kind !== 'anthropic' && (
        <label>
          URL de l’API
          <input value={p.baseUrl ?? ''} onChange={(e) => set('baseUrl', e.target.value)} placeholder="https://…/v1" />
        </label>
      )}
      {(needsKey || p.kind === 'openai-compatible') && (
        <label>
          Clé API {initial.hasApiKey && <span className="muted small">(enregistrée — laisser vide pour la conserver)</span>}
          <input type="password" value={p.apiKey ?? ''} onChange={(e) => set('apiKey', e.target.value)} placeholder="sk-…" />
        </label>
      )}
      <label>
        Modèle
        <div className="row gap">
          {models.length ? (
            <select value={p.model} onChange={(e) => set('model', e.target.value)}>
              {!models.some((m) => m.id === p.model) && p.model && <option value={p.model}>{p.model}</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label ? `${m.label} (${m.id})` : m.id}
                </option>
              ))}
            </select>
          ) : (
            <input value={p.model} onChange={(e) => set('model', e.target.value)} placeholder="nom du modèle" />
          )}
          <button className="btn small" disabled={busy} onClick={fetchModels}>
            Lister
          </button>
        </div>
      </label>
      <div className="row gap">
        <label>
          Appel d’outils
          <select value={p.toolMode} onChange={(e) => set('toolMode', e.target.value as ProviderConfig['toolMode'])}>
            <option value="native">Natif (function calling)</option>
            <option value="prompt">Par prompt (modèles sans tools)</option>
          </select>
        </label>
        <label>
          Max tokens / réponse
          <input type="number" value={p.maxTokens} onChange={(e) => set('maxTokens', Number(e.target.value))} />
        </label>
        {(p.kind === 'anthropic' || p.kind === 'anthropic-compatible') && (
          <label>
            Effort
            <select value={p.effort ?? 'high'} onChange={(e) => set('effort', e.target.value as ProviderConfig['effort'])}>
              {['low', 'medium', 'high', 'xhigh', 'max'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {msg && <div className="small muted">{msg}</div>}
      <div className="modal-actions">
        {p.id && (
          <button className="btn danger ghost" onClick={() => confirm('Supprimer ce fournisseur ?') && onDelete(p.id)}>
            Supprimer
          </button>
        )}
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            const r = await window.api.settings.testProvider(p)
            setBusy(false)
            setMsg((r.ok ? '✅ ' : '❌ ') + r.message)
          }}
        >
          Tester
        </button>
        {p.id && !isActive && (
          <button className="btn" onClick={() => onActivate(p.id)}>
            Utiliser par défaut
          </button>
        )}
        <button
          className="btn primary"
          onClick={async () => {
            const s = await window.api.settings.upsertProvider(p)
            if (!p.id) {
              const created = s.providers[s.providers.length - 1]
              onSaved(await window.api.settings.save({ activeProviderId: created.id }))
            } else onSaved(s)
          }}
        >
          Enregistrer
        </button>
      </div>
    </div>
  )
}

function General({ settings, onChange }: { settings: AppSettings; onChange: (s: AppSettings) => void }) {
  const save = async (p: Partial<AppSettings>): Promise<void> => onChange(await window.api.settings.save(p))
  return (
    <div className="form">
      <label>
        Niveau d’autonomie
        <select value={settings.approvalMode} onChange={(e) => save({ approvalMode: e.target.value as AppSettings['approvalMode'] })}>
          <option value="autopilot">Autopilot — mission non surveillée, l’agent va jusqu’au bout (garde-fous actifs)</option>
          <option value="ask-commands">Valider les commandes shell et déploiements</option>
          <option value="ask-all">Valider toute modification</option>
        </select>
      </label>
      <label>
        Étapes max par segment (autopilote : prolongé automatiquement, plafond 12 h)
        <input type="number" value={settings.maxIterations} onChange={(e) => save({ maxIterations: Number(e.target.value) || 150 })} />
      </label>
      <label>
        Dossier des nouveaux projets
        <div className="row gap">
          <input value={settings.workspaceDir} readOnly />
          <button
            className="btn small"
            onClick={async () => {
              const d = await window.api.projects.pickDirectory()
              if (d) save({ workspaceDir: d })
            }}
          >
            Changer
          </button>
        </div>
      </label>
      <label>
        Thème
        <select value={settings.theme} onChange={(e) => save({ theme: e.target.value as AppSettings['theme'] })}>
          <option value="dark">Sombre</option>
          <option value="light">Clair</option>
        </select>
      </label>
    </div>
  )
}

function Secrets({ settings, onChange }: { settings: AppSettings; onChange: (s: AppSettings) => void }) {
  const [rows, setRows] = useState<[string, string][]>(() => {
    const keys = new Set([...Object.keys(SECRET_HINTS), ...Object.keys(settings.secrets)])
    return [...keys].map((k) => [k, settings.secrets[k] ?? ''])
  })
  const [saved, setSaved] = useState(false)
  return (
    <div className="form">
      <p className="muted small">
        Chiffrés sur ce PC (coffre du système). Injectés comme variables d’environnement dans les commandes de l’agent — jamais envoyés au
        modèle IA.
      </p>
      {rows.map(([k, v], i) => (
        <div key={i} className="secret-row">
          <input
            className="mono"
            value={k}
            onChange={(e) => setRows(rows.map((r, j) => (j === i ? [e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''), r[1]] : r)))}
          />
          <input type="password" value={v} placeholder={SECRET_HINTS[k] ?? ''} onChange={(e) => setRows(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} />
        </div>
      ))}
      <div className="row gap">
        <button className="btn small" onClick={() => setRows([...rows, ['', '']])}>
          + Ajouter
        </button>
        <button
          className="btn primary small"
          onClick={async () => {
            onChange(await window.api.settings.save({ secrets: Object.fromEntries(rows.filter(([k]) => k)) }))
            setSaved(true)
            setTimeout(() => setSaved(false), 1500)
          }}
        >
          {saved ? 'Enregistré ✓' : 'Enregistrer'}
        </button>
      </div>
    </div>
  )
}

function EnvCheck() {
  const [env, setEnv] = useState<Record<string, string | null> | null>(null)
  useEffect(() => {
    window.api.env.check().then(setEnv)
  }, [])
  const hints: Record<string, string> = {
    node: 'Requis — nodejs.org',
    git: 'Requis — git-scm.com',
    docker: 'Optionnel — Postgres local / VPS',
    eas: 'Optionnel — utilisé via npx eas-cli',
    flyctl: 'Optionnel — déploiement Fly.io',
    railway: 'Optionnel — utilisé via npx @railway/cli',
    vercel: 'Optionnel — utilisé via npx vercel',
    java: 'Optionnel — builds Android locaux',
    adb: 'Optionnel — émulateur / appareil Android en USB'
  }
  if (!env) return <div className="muted">Vérification des outils…</div>
  return (
    <table className="env">
      <tbody>
        {Object.entries(env).map(([k, v]) => (
          <tr key={k}>
            <td>{v ? '✅' : '—'}</td>
            <td>
              <b>{k}</b>
            </td>
            <td className="small">{v ?? <span className="muted">{hints[k] ?? 'non trouvé'}</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
