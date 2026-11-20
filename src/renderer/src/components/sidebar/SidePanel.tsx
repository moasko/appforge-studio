import { useState } from 'react'
import { ChevronRight, ChevronDown, RefreshCw, FolderOpen, Plus, Trash2, FolderGit2, Square, RotateCw, Play, Rocket, Smartphone, Server, Database, Globe, AlertTriangle, ExternalLink } from 'lucide-react'
import { useEffect } from 'react'
import type { DeployTarget, FileNode } from '@shared/types'
import { actions, setState, useStore } from '../../store/appStore'
import { useProcesses } from '../../hooks/useProcesses'
import { Dot, IconButton, fileIcon } from '../ui'

export function SidePanel() {
  const view = useStore((s) => s.sideView)
  if (!view) return null
  return (
    <aside className="sidepanel">
      {view === 'explorer' && <ExplorerView />}
      {view === 'projects' && <ProjectsView />}
      {view === 'processes' && <ProcessesView />}
      {view === 'deploy' && <DeployView />}
    </aside>
  )
}

function PanelHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="panel-header">
      <span>{title}</span>
      <div className="panel-actions">{children}</div>
    </div>
  )
}

/* ------------------------------- Explorateur ------------------------------ */

function ExplorerView() {
  const current = useStore((s) => s.current)
  const tree = useStore((s) => s.tree)
  const active = useStore((s) => s.activeTab)
  const dirty = useStore((s) => s.dirtyFiles)
  const [open, setOpen] = useState<Set<string>>(new Set(['mobile', 'api', 'api/src', 'mobile/src', 'mobile/app']))

  if (!current) return <PanelHeader title="Explorateur" />

  const toggle = (p: string): void => {
    const s = new Set(open)
    if (s.has(p)) s.delete(p)
    else s.add(p)
    setOpen(s)
  }

  const render = (nodes: FileNode[], depth: number): React.ReactNode =>
    nodes.map((n) => {
      const pad = { paddingLeft: 10 + depth * 12 }
      if (n.type === 'dir') {
        const isOpen = open.has(n.path)
        return (
          <div key={n.path}>
            <div className="tree-item" style={pad} onClick={() => toggle(n.path)}>
              {isOpen ? <ChevronDown size={14} className="tree-chev" /> : <ChevronRight size={14} className="tree-chev" />}
              <span className="tree-label dir">{n.name}</span>
            </div>
            {isOpen && <div className="tree-children">{render(n.children ?? [], depth + 1)}</div>}
          </div>
        )
      }
      const { Icon, color } = fileIcon(n.name)
      return (
        <div key={n.path} className={`tree-item file${active === n.path ? ' active' : ''}`} style={pad} onClick={() => actions.openFile(n.path)}>
          <span className="tree-chev-space" />
          <Icon size={14} color={color} strokeWidth={1.75} />
          <span className="tree-label">{n.name}</span>
          {dirty.includes(n.path) && <span className="tree-dirty" />}
        </div>
      )
    })

  return (
    <>
      <PanelHeader title={current.name}>
        <IconButton icon={RefreshCw} label="Rafraîchir" size={14} onClick={() => actions.refreshTree()} />
        <IconButton icon={FolderOpen} label="Ouvrir dans l'explorateur" size={14} onClick={() => window.api.projects.reveal(current.id)} />
      </PanelHeader>
      <div className="panel-body tree">{tree.length ? render(tree, 0) : <div className="panel-empty">Projet vide — décrivez votre app à l’agent.</div>}</div>
    </>
  )
}

/* --------------------------------- Projets -------------------------------- */

function ProjectsView() {
  const projects = useStore((s) => s.projects)
  const current = useStore((s) => s.current)

  const openFolder = async (): Promise<void> => {
    const dir = await window.api.projects.pickDirectory()
    if (!dir) return
    const p = await window.api.projects.open(dir)
    await actions.refreshProjects()
    actions.selectProject(p)
  }

  return (
    <>
      <PanelHeader title="Projets">
        <IconButton icon={Plus} label="Nouvelle app" size={14} onClick={() => setState({ modal: 'new' })} />
        <IconButton icon={FolderOpen} label="Ouvrir un dossier" size={14} onClick={openFolder} />
      </PanelHeader>
      <div className="panel-body">
        {projects.map((p) => (
          <div key={p.id} className={`project-card${current?.id === p.id ? ' active' : ''}`} onClick={() => actions.selectProject(p)}>
            <div className="project-avatar">{p.name.slice(0, 2).toUpperCase()}</div>
            <div className="project-meta">
              <div className="project-title">{p.name}</div>
              <div className="project-sub" title={p.path}>
                <FolderGit2 size={11} /> {p.path}
              </div>
            </div>
            <IconButton
              icon={Trash2}
              label="Retirer de la liste"
              size={13}
              className="project-remove"
              onClick={async (e) => {
                e.stopPropagation()
                if (!confirm(`Retirer « ${p.name} » de la liste ? Les fichiers restent sur le disque.`)) return
                await window.api.projects.remove(p.id)
                const list = await actions.refreshProjects()
                if (current?.id === p.id) actions.selectProject(list[0] ?? null)
              }}
            />
          </div>
        ))}
        {!projects.length && <div className="panel-empty">Aucun projet.</div>}
      </div>
    </>
  )
}

/* -------------------------------- Services -------------------------------- */

const PRESETS = [
  { label: 'api', title: 'API (dev)', cmd: 'npm run dev', cwd: 'api', icon: Server },
  { label: 'mobile', title: 'Expo (LAN)', cmd: 'npx expo start --lan', cwd: 'mobile', icon: Smartphone },
  { label: 'mobile', title: 'Expo (tunnel)', cmd: 'npx expo start --tunnel', cwd: 'mobile', icon: Globe },
  { label: 'db-studio', title: 'Drizzle Studio', cmd: 'npx drizzle-kit studio', cwd: 'api', icon: Database }
]

function ProcessesView() {
  const current = useStore((s) => s.current)
  const procs = useProcesses(current?.id ?? '')
  if (!current) return <PanelHeader title="Services" />
  const latest = [...new Map(procs.map((p) => [p.label, p])).values()].sort((a, b) => b.startedAt - a.startedAt)

  return (
    <>
      <PanelHeader title="Services" />
      <div className="panel-body">
        <div className="panel-section">En cours</div>
        {latest.length ? (
          latest.map((p) => (
            <div key={p.id} className="svc-row">
              <Dot state={p.status === 'running' ? 'on' : p.status === 'error' ? 'err' : 'off'} />
              <div className="svc-meta">
                <div className="svc-name">{p.label}</div>
                <div className="svc-cmd">{p.command}</div>
                {p.urls.slice(0, 2).map((u) => (
                  <a key={u} className="svc-url" onClick={() => window.api.util.openExternal(u)}>
                    <ExternalLink size={10} /> {u}
                  </a>
                ))}
              </div>
              {p.status === 'running' ? (
                <IconButton icon={Square} label="Arrêter" size={13} onClick={() => window.api.proc.stop(p.id)} />
              ) : (
                <IconButton
                  icon={RotateCw}
                  label="Relancer"
                  size={13}
                  onClick={() => window.api.proc.start(current.id, p.label, p.command, relCwd(p.cwd, current.path))}
                />
              )}
            </div>
          ))
        ) : (
          <div className="panel-empty">Aucun service lancé.</div>
        )}
        <div className="panel-section">Démarrage rapide</div>
        {PRESETS.map((p) => (
          <button
            key={p.title}
            className="quick-btn"
            onClick={() => {
              window.api.proc.start(current.id, p.label, p.cmd, p.cwd)
              setState({ bottomOpen: true })
            }}
          >
            <p.icon size={14} /> {p.title}
            <Play size={11} className="quick-play" />
          </button>
        ))}
      </div>
    </>
  )
}

function relCwd(abs: string, root: string): string {
  const a = abs.replace(/\\/g, '/')
  const r = root.replace(/\\/g, '/')
  return a.startsWith(r) ? a.slice(r.length).replace(/^\//, '') : ''
}

/* ------------------------------- Déploiement ------------------------------ */

const CAT_ICON = { mobile: Smartphone, backend: Server, database: Database, web: Globe }
const CAT_LABEL = { mobile: 'Mobile', backend: 'Backend', database: 'Base de données', web: 'Web' }

function DeployView() {
  const settings = useStore((s) => s.settings)
  const [targets, setTargets] = useState<DeployTarget[]>([])
  useEffect(() => {
    window.api.deploy.targets().then(setTargets)
  }, [])
  const cats = [...new Set(targets.map((t) => t.category))]

  return (
    <>
      <PanelHeader title="Héberger & déployer" />
      <div className="panel-body">
        {cats.map((c) => {
          const CIcon = CAT_ICON[c]
          return (
            <div key={c}>
              <div className="panel-section">
                <CIcon size={11} /> {CAT_LABEL[c]}
              </div>
              {targets
                .filter((t) => t.category === c)
                .map((t) => {
                  const missing = t.requiredSecrets.filter((s) => !settings?.secrets[s])
                  return (
                    <div key={t.id} className="deploy-item">
                      <div className="deploy-meta">
                        <div className="deploy-title">{t.label}</div>
                        <div className="deploy-desc">{t.description}</div>
                        {missing.length > 0 && (
                          <div className="deploy-warn" onClick={() => setState({ modal: 'settings' })}>
                            <AlertTriangle size={11} /> {missing.join(', ')}
                          </div>
                        )}
                      </div>
                      <IconButton icon={Rocket} label="Confier à l'agent" size={14} className="deploy-go" onClick={() => actions.runAgent(t.prompt)} />
                    </div>
                  )
                })}
            </div>
          )
        })}
      </div>
    </>
  )
}
