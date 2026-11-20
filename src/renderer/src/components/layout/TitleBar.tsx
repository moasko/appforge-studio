import { Search, PanelLeft, PanelBottom, PanelRight, Play, Smartphone, Server, ChevronRight, Hexagon } from 'lucide-react'
import { actions, setState, useStore } from '../../store/appStore'
import { IconButton, Kbd } from '../ui'

export function TitleBar() {
  const current = useStore((s) => s.current)
  const sideView = useStore((s) => s.sideView)
  const bottomOpen = useStore((s) => s.bottomOpen)
  const previewOpen = useStore((s) => s.previewOpen)
  const isMac = window.api.util.platform === 'darwin'

  const start = (label: string, cmd: string, cwd: string): void => {
    if (!current) return
    window.api.proc.start(current.id, label, cmd, cwd)
    setState({ bottomOpen: true })
    actions.toast(`${label === 'api' ? 'API' : 'Expo'} en cours de démarrage…`)
  }

  return (
    <header className={`titlebar${isMac ? ' mac' : ''}`}>
      <div className="tb-left">
        <div className="tb-logo">
          <Hexagon size={16} strokeWidth={2.2} />
        </div>
        <span className="tb-app">AppForge</span>
        {current && (
          <>
            <ChevronRight size={13} className="tb-sep" />
            <span className="tb-project">{current.name}</span>
          </>
        )}
      </div>

      <button className="tb-search no-drag" onClick={() => setState({ modal: 'palette' })}>
        <Search size={13} />
        <span>Rechercher un fichier, lancer une commande…</span>
        <Kbd>Ctrl K</Kbd>
      </button>

      <div className="tb-right no-drag">
        {current && (
          <div className="tb-run">
            <button className="tb-run-btn" onClick={() => start('api', 'npm run dev', 'api')} data-tip="Démarrer l'API">
              <Play size={11} fill="currentColor" />
              <Server size={13} /> API
            </button>
            <button className="tb-run-btn" onClick={() => start('mobile', 'npx expo start --lan', 'mobile')} data-tip="Démarrer Expo">
              <Play size={11} fill="currentColor" />
              <Smartphone size={13} /> Expo
            </button>
          </div>
        )}
        <div className="tb-toggles">
          <IconButton icon={PanelLeft} label="Barre latérale" shortcut="Ctrl B" active={!!sideView} onClick={() => setState({ sideView: sideView ? null : 'explorer' })} />
          <IconButton icon={PanelBottom} label="Terminal" shortcut="Ctrl J" active={bottomOpen} onClick={() => setState({ bottomOpen: !bottomOpen })} />
          <IconButton icon={PanelRight} label="Aperçu" shortcut="Ctrl P" active={previewOpen} onClick={() => setState({ previewOpen: !previewOpen })} />
        </div>
      </div>
    </header>
  )
}
