import { BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import QRCode from 'qrcode'
import { IPC } from '@shared/ipc'
import type { AgentEvent, AppSettings, MemoryCategory, ProjectStack, ProviderConfig, SearchHit } from '@shared/types'
import * as settings from './services/settings'
import * as projects from './services/projects'
import * as files from './services/fileService'
import * as git from './services/git'
import { processManager } from './services/processManager'
import { checkEnvironment, runCommand } from './services/shell'
import { lanIp } from './agent/tools/scaffoldTools'
import * as memory from './services/memory'
import { listModels, testProvider } from './ai/registry'
import { AgentManager } from './agent/manager'
import { DEPLOY_TARGETS } from './agent/deployTargets'

export function registerIpc(getWin: () => BrowserWindow | null): AgentManager {
  const send = (channel: string, payload: unknown): void => {
    const w = getWin()
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
  }

  // Notifie la fin d'une longue mission quand l'utilisateur n'est pas devant l'écran
  const runStarts = new Map<string, number>()
  const notifyDone = (runId: string, reason: string): void => {
    const started = runStarts.get(runId)
    runStarts.delete(runId)
    if (!started) return
    const mins = Math.round((Date.now() - started) / 60_000)
    const w = getWin()
    if (mins < 5 || (w && !w.isDestroyed() && w.isFocused()) || !Notification.isSupported()) return
    new Notification({ title: 'AppForge Studio', body: `Mission terminée (${reason}) après ${mins} min.` }).show()
  }

  const agents = new AgentManager((e: AgentEvent) => {
    if (e.type === 'start') runStarts.set(e.runId, Date.now())
    if (e.type === 'done') notifyDone(e.runId, e.reason)
    send(IPC.agentEvent, e)
  })
  processManager.on('event', (e) => send(IPC.procEvent, e))

  /** Retrouve la config complète (avec clé) à partir de la version UI */
  const withKey = (p: ProviderConfig): ProviderConfig => {
    const saved = settings.loadSettings().providers.find((x) => x.id === p.id)
    return { ...p, apiKey: p.apiKey || saved?.apiKey }
  }

  // Réglages & fournisseurs
  ipcMain.handle(IPC.settingsGet, () => settings.publicSettings())
  ipcMain.handle(IPC.settingsSave, (_e, partial: Partial<AppSettings>) => settings.updateFromUi(partial))
  ipcMain.handle(IPC.providerUpsert, (_e, p: ProviderConfig) => settings.upsertProvider(p))
  ipcMain.handle(IPC.providerDelete, (_e, id: string) => settings.deleteProvider(id))
  ipcMain.handle(IPC.providerTest, (_e, p: ProviderConfig) => testProvider(withKey(p)))
  ipcMain.handle(IPC.providerModels, async (_e, p: ProviderConfig) => {
    try {
      return { ok: true, models: await listModels(withKey(p)) }
    } catch (err) {
      return { ok: false, models: [], error: (err as Error).message }
    }
  })

  // Projets
  ipcMain.handle(IPC.projectsList, () => projects.listProjects())
  ipcMain.handle(IPC.projectCreate, (_e, name: string, stack?: ProjectStack) => projects.createProject(name, stack))
  ipcMain.handle(IPC.projectOpen, (_e, dir: string) => projects.openProject(dir))
  ipcMain.handle(IPC.projectRemove, (_e, id: string) => projects.removeProject(id))
  ipcMain.handle(IPC.pickDirectory, async () => {
    const w = getWin()
    const r = w ? await dialog.showOpenDialog(w, { properties: ['openDirectory', 'createDirectory'] }) : null
    return r && !r.canceled ? r.filePaths[0] : null
  })
  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    if (/^(https?|exp):\/\//.test(url)) shell.openExternal(url)
  })
  ipcMain.handle(IPC.openInExplorer, (_e, projectId: string) => shell.openPath(projects.getProject(projectId).path))

  // Fichiers
  ipcMain.handle(IPC.fsTree, (_e, projectId: string) => files.tree(projects.getProject(projectId).path))
  ipcMain.handle(IPC.fsRead, (_e, projectId: string, rel: string) => files.readText(projects.getProject(projectId).path, rel))
  ipcMain.handle(IPC.fsWrite, (_e, projectId: string, rel: string, content: string) =>
    files.writeText(projects.getProject(projectId).path, rel, content)
  )
  ipcMain.handle(IPC.fsSymbols, (_e, projectId: string) => files.collectSymbols(projects.getProject(projectId).path))
  ipcMain.handle(IPC.fsSearch, (_e, projectId: string, query: string): { ok: boolean; hits: SearchHit[]; error?: string } => {
    const q = String(query ?? '').trim()
    if (q.length < 2) return { ok: true, hits: [] }
    try {
      const re = new RegExp(files.escapeRegExp(q), 'i')
      return { ok: true, hits: files.searchText(projects.getProject(projectId).path, re, { maxHits: 100 }) }
    } catch (err) {
      return { ok: false, hits: [], error: (err as Error).message }
    }
  })

  // Agent
  ipcMain.handle(IPC.agentSend, (_e, projectId: string, text: string) => {
    const s = agents.get(projectId)
    if (s.running) return { ok: false, error: 'Une tâche est déjà en cours.' }
    s.send(text).catch((err) => send(IPC.agentEvent, { type: 'error', projectId, runId: '', message: String(err?.message ?? err) }))
    return { ok: true }
  })
  ipcMain.handle(IPC.agentStop, (_e, projectId: string) => agents.get(projectId).stop())
  ipcMain.handle(IPC.agentApprove, (_e, projectId: string, callId: string, ok: boolean) => agents.get(projectId).approve(callId, ok))
  ipcMain.handle(IPC.agentHistory, (_e, projectId: string) => ({
    items: agents.get(projectId).getItems(),
    running: agents.get(projectId).running,
    startedAt: agents.get(projectId).startedAt
  }))
  ipcMain.handle(IPC.agentClear, (_e, projectId: string) => agents.get(projectId).clear())

  // Processus
  ipcMain.handle(IPC.procList, (_e, projectId?: string) => processManager.list(projectId))
  ipcMain.handle(IPC.procStart, (_e, projectId: string, label: string, command: string, cwdRel: string) => {
    const root = projects.getProject(projectId).path
    return processManager.start(projectId, label, command, files.safeResolve(root, cwdRel || ''))
  })
  ipcMain.handle(IPC.procStop, (_e, id: string) => processManager.stop(id))
  ipcMain.handle(IPC.procLogs, (_e, id: string) => processManager.logs(id, 200_000))

  // Divers
  ipcMain.handle(IPC.deployTargets, () => DEPLOY_TARGETS)
  ipcMain.handle(IPC.envCheck, () => checkEnvironment())
  ipcMain.handle(IPC.qrCode, (_e, text: string) => QRCode.toDataURL(text, { margin: 1, width: 240 }))
  ipcMain.handle(IPC.projectInfo, async (_e, projectId: string) => {
    const root = projects.getProject(projectId).path
    const r = await runCommand('git rev-parse --abbrev-ref HEAD', root, { timeoutMs: 5000 })
    const dirty = await runCommand('git status --porcelain', root, { timeoutMs: 5000 })
    return {
      branch: r.exitCode === 0 ? r.output.trim() : null,
      changes: dirty.exitCode === 0 ? dirty.output.split('\n').filter(Boolean).length : 0,
      lanIp: lanIp()
    }
  })
  ipcMain.handle(IPC.gitStatus, (_e, projectId: string) => git.status(projects.getProject(projectId).path))
  ipcMain.handle(IPC.gitRestore, (_e, projectId: string, paths: string[]) =>
    git.restore(projects.getProject(projectId).path, paths)
  )
  ipcMain.handle(IPC.gitClean, (_e, projectId: string, paths: string[]) =>
    git.cleanUntracked(projects.getProject(projectId).path, paths)
  )

  // Mémoire du projet
  ipcMain.handle(IPC.memoryList, (_e, projectId: string) => memory.loadMemory(projects.getProject(projectId).path))
  ipcMain.handle(IPC.memoryAdd, (_e, projectId: string, category: MemoryCategory, text: string) =>
    memory.addMemory(projects.getProject(projectId).path, category, text)
  )
  ipcMain.handle(IPC.memoryDelete, (_e, projectId: string, id: string) =>
    memory.removeMemory(projects.getProject(projectId).path, id)
  )
  ipcMain.handle(IPC.titleBarTheme, (_e, dark: boolean) => {
    const w = getWin()
    if (w && process.platform !== 'darwin') {
      try {
        w.setTitleBarOverlay({ color: dark ? '#0b0d12' : '#f3f4f8', symbolColor: dark ? '#9aa3b5' : '#4a5163', height: 40 })
      } catch {
        /* overlay non supporté */
      }
    }
  })

  return agents
}
