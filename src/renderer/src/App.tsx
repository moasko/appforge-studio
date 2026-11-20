import { useEffect } from 'react'
import { actions, getState, setState, useStore } from './store/appStore'
import { TitleBar } from './components/layout/TitleBar'
import { ActivityBar } from './components/layout/ActivityBar'
import { StatusBar } from './components/layout/StatusBar'
import { Splitter } from './components/layout/Splitter'
import { SidePanel } from './components/sidebar/SidePanel'
import { EditorArea } from './components/editor/EditorArea'
import { TerminalPanel } from './components/panels/TerminalPanel'
import { PreviewPanel } from './components/panels/PreviewPanel'
import { CommandPalette } from './components/overlays/CommandPalette'
import { Toasts } from './components/overlays/Toasts'
import { SettingsModal } from './components/SettingsModal'
import { NewProjectModal } from './components/NewProjectModal'
import { GitModal } from './components/GitModal'
import { MemoryModal } from './components/MemoryModal'
import { Welcome } from './components/Welcome'

export default function App() {
  const settings = useStore((s) => s.settings)
  const current = useStore((s) => s.current)
  const sideView = useStore((s) => s.sideView)
  const bottomOpen = useStore((s) => s.bottomOpen)
  const previewOpen = useStore((s) => s.previewOpen)
  const sizes = useStore((s) => s.sizes)
  const modal = useStore((s) => s.modal)

  // Chargement initial
  useEffect(() => {
    window.api.settings.get().then(actions.setSettings)
    actions.refreshProjects().then((list) => {
      let last: string | null = null
      try {
        last = localStorage.getItem('lastProject')
      } catch {
        /* ignore */
      }
      const p = list.find((x) => x.id === last) ?? list[0] ?? null
      if (p) actions.selectProject(p)
    })
  }, [])

  // Thème (+ couleur de la barre de titre native)
  useEffect(() => {
    const theme = settings?.theme ?? 'dark'
    document.documentElement.dataset.theme = theme
    window.api.util.setTitleBarTheme(theme === 'dark')
  }, [settings?.theme])

  // Mission en cours suivie globalement : le chronomètre reste visible en changeant de projet
  useEffect(
    () =>
      window.api.agent.onEvent((e) => {
        if (e.type === 'start')
          setState({
            agentRunning: true,
            agentStartedAt: e.startedAt,
            agentProjectId: e.projectId ?? null,
            agentConversationId: e.conversationId ?? null
          })
        else if (e.type === 'done') setState({ agentRunning: false, agentStartedAt: null, agentProjectId: null, agentConversationId: null })
      }),
    []
  )

  // Expo prêt : on ouvre l'aperçu sur le QR code (une fois par lancement de serveur)
  useEffect(() => {
    const seen = new Set<string>()
    return window.api.proc.onEvent((e) => {
      if (e.type !== 'status' || e.info.status !== 'running') return
      if (e.info.projectId !== getState().current?.id) return
      if (seen.has(e.info.id) || !e.info.urls.some((u) => /^exps?:\/\//.test(u))) return
      seen.add(e.info.id)
      setState({ previewOpen: true })
      window.dispatchEvent(new Event('expo-ready'))
      actions.toast('Expo est prêt — scannez le QR code dans l’aperçu', 'success')
    })
  }, [])

  // Santé du fournisseur IA actif (pastille de la barre de statut)
  useEffect(() => {
    const p = settings?.providers.find((x) => x.id === settings.activeProviderId)
    if (!p) return setState({ providerOnline: null })
    let alive = true
    const check = (): void => {
      window.api.settings.testProvider(p).then((r) => alive && setState({ providerOnline: r.ok }))
    }
    check()
    const t = setInterval(check, 60_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [settings?.activeProviderId, settings?.providers])

  // Raccourcis clavier globaux
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (mod && k === 'k') {
        e.preventDefault()
        setState({ modal: getState().modal === 'palette' ? null : 'palette' })
      } else if (mod && e.shiftKey && k === 'e') {
        e.preventDefault()
        setState({ sideView: 'explorer' })
      } else if (mod && e.shiftKey && k === 'o') {
        e.preventDefault()
        setState({ sideView: 'projects' })
      } else if (mod && e.shiftKey && k === 's') {
        e.preventDefault()
        setState({ sideView: 'processes' })
      } else if (mod && e.shiftKey && k === 'd') {
        e.preventDefault()
        setState({ sideView: 'deploy' })
      } else if (mod && k === 'b') {
        e.preventDefault()
        setState((s) => ({ sideView: s.sideView ? null : 'explorer' }))
      } else if (mod && k === 'j') {
        e.preventDefault()
        setState((s) => ({ bottomOpen: !s.bottomOpen }))
      } else if (mod && k === 'p') {
        e.preventDefault()
        setState((s) => ({ previewOpen: !s.previewOpen }))
      } else if (mod && e.shiftKey && k === 'n') {
        e.preventDefault()
        setState({ activeTab: 'agent' })
        window.dispatchEvent(new Event('new-conversation'))
      } else if (mod && k === 'n') {
        e.preventDefault()
        setState({ modal: 'new' })
      } else if (mod && k === ',') {
        e.preventDefault()
        setState({ modal: 'settings' })
      } else if (mod && k === 'l') {
        e.preventDefault()
        setState({ activeTab: 'agent' })
        window.dispatchEvent(new Event('focus-composer'))
      } else if (mod && k === 'w') {
        const tab = getState().activeTab
        if (tab !== 'agent') {
          e.preventDefault()
          actions.closeFile(tab)
        }
      } else if (e.key === 'Escape' && getState().modal) {
        setState({ modal: null })
      }
    }
    // Phase de capture : les raccourcis fonctionnent même quand l'éditeur de code a le focus
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  if (!settings) return <div className="boot" />

  return (
    <div className="shell">
      <TitleBar />
      <div className="workbench">
        <ActivityBar />
        {sideView && (
          <>
            <div style={{ width: sizes.side }} className="side-wrap">
              <SidePanel />
            </div>
            <Splitter direction="x" value={sizes.side} min={190} max={520} onChange={(v) => actions.setSize('side', v)} />
          </>
        )}
        {current ? (
          <>
            <div className="center">
              <EditorArea />
              {bottomOpen && (
                <>
                  <Splitter direction="y" value={sizes.bottom} min={120} max={600} invert onChange={(v) => actions.setSize('bottom', v)} />
                  <TerminalPanel />
                </>
              )}
            </div>
            {previewOpen && (
              <>
                <Splitter direction="x" value={sizes.preview} min={300} max={720} invert onChange={(v) => actions.setSize('preview', v)} />
                <PreviewPanel />
              </>
            )}
          </>
        ) : (
          <Welcome />
        )}
      </div>
      <StatusBar />

      <CommandPalette />
      <Toasts />
      {modal === 'settings' && <SettingsModal settings={settings} onChange={actions.setSettings} onClose={() => setState({ modal: null })} />}
      {modal === 'git' && current && <GitModal projectId={current.id} onClose={() => setState({ modal: null })} />}
      {modal === 'memory' && current && <MemoryModal projectId={current.id} onClose={() => setState({ modal: null })} />}
      {modal === 'new' && (
        <NewProjectModal
          onClose={() => setState({ modal: null })}
          onCreated={async (project, prompt) => {
            setState({ modal: null })
            await actions.refreshProjects()
            actions.selectProject(project)
            actions.runAgent(prompt)
          }}
        />
      )}
    </div>
  )
}
