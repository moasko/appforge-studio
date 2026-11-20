import { useEffect, useState } from 'react'
import { GitBranch, Wifi, Cpu, Zap, ShieldCheck, Hand, Lock, Bot, Brain } from 'lucide-react'
import { setState, useStore } from '../../store/appStore'
import { useProcesses } from '../../hooks/useProcesses'
import { Dot, Spinner } from '../ui'
import { formatElapsed, useElapsed } from '../../lib/time'

const MODE = {
  autopilot: { icon: Zap, label: 'Autopilot' },
  'ask-commands': { icon: Hand, label: 'Valider commandes' },
  'ask-all': { icon: Lock, label: 'Tout valider' }
} as const

export function StatusBar() {
  const current = useStore((s) => s.current)
  const settings = useStore((s) => s.settings)
  const running = useStore((s) => s.agentRunning)
  const startedAt = useStore((s) => s.agentStartedAt)
  const elapsed = useElapsed(running ? startedAt : null)
  const tokens = useStore((s) => s.tokens)
  const online = useStore((s) => s.providerOnline)
  const procs = useProcesses(current?.id ?? '').filter((p) => p.status === 'running')
  const [info, setInfo] = useState<{ branch: string | null; changes: number; lanIp: string } | null>(null)

  useEffect(() => {
    if (!current) return setInfo(null)
    const load = (): void => {
      window.api.projects.info(current.id).then(setInfo).catch(() => setInfo(null))
    }
    load()
    const off = window.api.agent.onEvent((e) => e.type === 'done' && e.projectId === current.id && load())
    window.addEventListener('git-changed', load)
    const t = setInterval(load, 15000)
    return () => {
      off()
      window.removeEventListener('git-changed', load)
      clearInterval(t)
    }
  }, [current?.id])

  const provider = settings?.providers.find((p) => p.id === settings.activeProviderId)
  const mode = MODE[settings?.approvalMode ?? 'autopilot']
  const ModeIcon = mode.icon

  return (
    <footer className={`statusbar${running ? ' busy' : ''}`}>
      <div className="sb-group">
        {info?.branch && (
          <span
            className="sb-item clickable"
            data-tip="Voir et annuler les modifications non commitées"
            onClick={() => setState({ modal: 'git' })}
          >
            <GitBranch size={12} /> {info.branch}
            {info.changes > 0 && <span className="sb-muted">• {info.changes}</span>}
          </span>
        )}
        {current && (
          <span className="sb-item clickable" onClick={() => setState({ modal: 'memory' })} data-tip="Mémoire du projet (faits injectés à l’agent)">
            <Brain size={12} /> Mémoire
          </span>
        )}
        <span className="sb-item clickable" onClick={() => setState({ sideView: 'processes' })} data-tip="Services en cours">
          <Cpu size={12} /> {procs.length} service{procs.length > 1 ? 's' : ''}
        </span>
        {info && (
          <span className="sb-item" data-tip="IP réseau local (Expo Go / API depuis le téléphone)">
            <Wifi size={12} /> {info.lanIp}
          </span>
        )}
      </div>
      <div className="sb-group">
        {running && (
          <span className="sb-item accent" data-tip="Durée de la mission en cours">
            <Spinner size={10} /> Agent au travail{elapsed ? ` · ${formatElapsed(elapsed)}` : ''}
          </span>
        )}
        {tokens.in + tokens.out > 0 && (
          <span className="sb-item" data-tip="Tokens consommés (entrée · sortie)">
            {(tokens.in / 1000).toFixed(1)}k · {(tokens.out / 1000).toFixed(1)}k
          </span>
        )}
        <span className="sb-item clickable" onClick={() => setState({ modal: 'settings' })} data-tip="Niveau d'autonomie">
          <ModeIcon size={12} /> {mode.label}
        </span>
        <span className="sb-item clickable" onClick={() => setState({ modal: 'settings' })} data-tip={online === false ? 'Fournisseur injoignable' : 'Fournisseur IA actif'}>
          <Dot state={online === null ? null : online ? 'on' : 'err'} />
          <Bot size={12} /> {provider ? `${provider.name} · ${provider.model || '—'}` : 'Aucun modèle'}
        </span>
        <span className="sb-item" data-tip="Clés et secrets chiffrés localement">
          <ShieldCheck size={12} />
        </span>
      </div>
    </footer>
  )
}
