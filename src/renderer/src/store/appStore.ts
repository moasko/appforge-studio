import { useSyncExternalStore } from 'react'
import type { AppSettings, FileNode, Project } from '@shared/types'

/**
 * Store global minimaliste (pattern "external store") :
 * un seul état, des actions explicites, abonnement par sélecteur.
 */
export type SideView = 'explorer' | 'projects' | 'processes' | 'deploy'
export type Modal = null | 'settings' | 'new' | 'palette' | 'git' | 'memory'

export interface Toast {
  id: string
  kind: 'info' | 'success' | 'error'
  text: string
}

export interface UIState {
  settings: AppSettings | null
  projects: Project[]
  current: Project | null
  tree: FileNode[]
  sideView: SideView | null
  bottomOpen: boolean
  previewOpen: boolean
  sizes: { side: number; preview: number; bottom: number }
  openFiles: string[]
  activeTab: string // 'agent' ou chemin de fichier
  dirtyFiles: string[]
  /** Ligne à révéler après une recherche de contenu */
  pendingReveal: { path: string; line: number } | null
  modal: Modal
  pendingPrompt: string | null
  toasts: Toast[]
  agentRunning: boolean
  /** Début de la mission en cours (chronomètre) */
  agentStartedAt: number | null
  /** Projet qui exécute la mission en cours (le suivi survit au changement d'onglet) */
  agentProjectId: string | null
  tokens: { in: number; out: number }
  providerOnline: boolean | null
}

const savedLayout = ((): Partial<UIState> => {
  try {
    return JSON.parse(localStorage.getItem('layout') ?? '{}')
  } catch {
    return {}
  }
})()

let state: UIState = {
  settings: null,
  projects: [],
  current: null,
  tree: [],
  sideView: 'explorer',
  bottomOpen: true,
  previewOpen: true,
  sizes: { side: 260, preview: 400, bottom: 220 },
  openFiles: [],
  activeTab: 'agent',
  dirtyFiles: [],
  pendingReveal: null,
  modal: null,
  pendingPrompt: null,
  toasts: [],
  agentRunning: false,
  agentStartedAt: null,
  agentProjectId: null,
  tokens: { in: 0, out: 0 },
  providerOnline: null,
  ...savedLayout
}

const listeners = new Set<() => void>()

export function getState(): UIState {
  return state
}

export function setState(patch: Partial<UIState> | ((s: UIState) => Partial<UIState>)): void {
  const p = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...p }
  if ('sideView' in p || 'bottomOpen' in p || 'previewOpen' in p || 'sizes' in p) {
    try {
      const { sideView, bottomOpen, previewOpen, sizes } = state
      localStorage.setItem('layout', JSON.stringify({ sideView, bottomOpen, previewOpen, sizes }))
    } catch {
      /* stockage indisponible */
    }
  }
  listeners.forEach((l) => l())
}

export function useStore<T>(selector: (s: UIState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => selector(state)
  )
}

/* -------------------------------- Actions -------------------------------- */

export const actions = {
  toast(text: string, kind: Toast['kind'] = 'info'): void {
    const id = crypto.randomUUID()
    setState((s) => ({ toasts: [...s.toasts, { id, kind, text }] }))
    setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4200)
  },

  async refreshProjects(): Promise<Project[]> {
    const projects = await window.api.projects.list()
    setState({ projects })
    return projects
  },

  async refreshTree(): Promise<void> {
    const cur = state.current
    if (!cur) return setState({ tree: [] })
    setState({ tree: await window.api.fs.tree(cur.id) })
  },

  selectProject(p: Project | null): void {
    if (state.current?.id === p?.id) return
    setState({ current: p, openFiles: [], activeTab: 'agent', dirtyFiles: [], pendingReveal: null, tree: [], tokens: { in: 0, out: 0 } })
    try {
      if (p) localStorage.setItem('lastProject', p.id)
    } catch {
      /* ignore */
    }
    actions.refreshTree()
  },

  async saveSettings(partial: Partial<AppSettings>): Promise<void> {
    setState({ settings: await window.api.settings.save(partial) })
  },

  setSettings(settings: AppSettings): void {
    setState({ settings })
  },

  toggleSide(view: SideView): void {
    setState((s) => ({ sideView: s.sideView === view ? null : view }))
  },

  openFile(path: string): void {
    setState((s) => ({
      openFiles: s.openFiles.includes(path) ? s.openFiles : [...s.openFiles, path],
      activeTab: path
    }))
  },

  openFileAt(path: string, line: number): void {
    setState((s) => ({
      openFiles: s.openFiles.includes(path) ? s.openFiles : [...s.openFiles, path],
      activeTab: path,
      pendingReveal: { path, line }
    }))
  },

  closeFile(path: string): void {
    setState((s) => {
      const idx = s.openFiles.indexOf(path)
      const openFiles = s.openFiles.filter((f) => f !== path)
      const activeTab = s.activeTab === path ? (openFiles[Math.max(0, idx - 1)] ?? 'agent') : s.activeTab
      return { openFiles, activeTab, dirtyFiles: s.dirtyFiles.filter((f) => f !== path) }
    })
  },

  setDirty(path: string, dirty: boolean): void {
    setState((s) => ({
      dirtyFiles: dirty ? [...new Set([...s.dirtyFiles, path])] : s.dirtyFiles.filter((f) => f !== path)
    }))
  },

  /** Envoie une mission à l'agent (depuis la palette, le déploiement, une nouvelle app...) */
  runAgent(prompt: string): void {
    setState({ pendingPrompt: prompt, activeTab: 'agent' })
  },

  setSize(key: keyof UIState['sizes'], value: number): void {
    setState((s) => ({ sizes: { ...s.sizes, [key]: value } }))
  }
}

/** Liste plate des fichiers (palette de commandes) */
export function flattenTree(nodes: FileNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type === 'file') out.push(n.path)
    else if (n.children) flattenTree(n.children, out)
  }
  return out
}
