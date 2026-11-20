import { Files, FolderKanban, Activity, Rocket, Settings, Plus } from 'lucide-react'
import { actions, setState, useStore, type SideView } from '../../store/appStore'
import { IconButton } from '../ui'
import { useProcesses } from '../../hooks/useProcesses'

const VIEWS: { id: SideView; icon: typeof Files; label: string; shortcut: string }[] = [
  { id: 'explorer', icon: Files, label: 'Explorateur', shortcut: 'Ctrl Maj E' },
  { id: 'projects', icon: FolderKanban, label: 'Projets', shortcut: 'Ctrl Maj O' },
  { id: 'processes', icon: Activity, label: 'Services', shortcut: 'Ctrl Maj S' },
  { id: 'deploy', icon: Rocket, label: 'Déploiement', shortcut: 'Ctrl Maj D' }
]

export function ActivityBar() {
  const sideView = useStore((s) => s.sideView)
  const current = useStore((s) => s.current)
  const running = useProcesses(current?.id ?? '').filter((p) => p.status === 'running').length

  return (
    <nav className="activitybar">
      <IconButton icon={Plus} label="Nouvelle app" shortcut="Ctrl N" className="ab-new" size={18} onClick={() => setState({ modal: 'new' })} />
      <div className="ab-sep" />
      {VIEWS.map((v) => (
        <div key={v.id} className="ab-item">
          <IconButton icon={v.icon} label={v.label} shortcut={v.shortcut} size={20} active={sideView === v.id} onClick={() => actions.toggleSide(v.id)} />
          {v.id === 'processes' && running > 0 && <span className="ab-badge">{running}</span>}
        </div>
      ))}
      <div className="grow" />
      <IconButton icon={Settings} label="Réglages" shortcut="Ctrl ," size={20} onClick={() => setState({ modal: 'settings' })} />
    </nav>
  )
}
