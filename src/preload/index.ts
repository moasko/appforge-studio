import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AgentEvent,
  AppSettings,
  ChatItem,
  ConversationMeta,
  DeployTarget,
  ImageAttachment,
  AgentMode,
  FileNode,
  GitStatus,
  MemoryCategory,
  MemoryEntry,
  ModelInfo,
  ProcessEvent,
  ProcessInfo,
  Project,
  ProjectStack,
  ProjectSymbol,
  ProviderConfig,
  SearchHit,
  SendOptions,
  UsageTotals
} from '@shared/types'
import type { MachineInfo } from '@shared/localModels'

const invoke = <T>(ch: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(ch, ...args)
const listen = <T>(ch: string, cb: (payload: T) => void): (() => void) => {
  const h = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(ch, h)
  return () => ipcRenderer.removeListener(ch, h)
}

/** API exposée à l'interface : seul point de contact avec le système. */
const api = {
  settings: {
    get: () => invoke<AppSettings>(IPC.settingsGet),
    save: (p: Partial<AppSettings>) => invoke<AppSettings>(IPC.settingsSave, p),
    upsertProvider: (p: ProviderConfig) => invoke<AppSettings>(IPC.providerUpsert, p),
    deleteProvider: (id: string) => invoke<AppSettings>(IPC.providerDelete, id),
    testProvider: (p: ProviderConfig) => invoke<{ ok: boolean; message: string }>(IPC.providerTest, p),
    listModels: (p: ProviderConfig) => invoke<{ ok: boolean; models: ModelInfo[]; error?: string }>(IPC.providerModels, p)
  },
  projects: {
    list: () => invoke<Project[]>(IPC.projectsList),
    create: (name: string, stack?: ProjectStack) => invoke<Project>(IPC.projectCreate, name, stack),
    open: (dir: string) => invoke<Project>(IPC.projectOpen, dir),
    remove: (id: string) => invoke<void>(IPC.projectRemove, id),
    pickDirectory: () => invoke<string | null>(IPC.pickDirectory),
    reveal: (id: string) => invoke<void>(IPC.openInExplorer, id),
    info: (id: string) => invoke<{ branch: string | null; changes: number; lanIp: string }>(IPC.projectInfo, id)
  },
  fs: {
    tree: (projectId: string) => invoke<FileNode[]>(IPC.fsTree, projectId),
    read: (projectId: string, p: string) => invoke<string>(IPC.fsRead, projectId, p),
    write: (projectId: string, p: string, c: string) => invoke<void>(IPC.fsWrite, projectId, p, c),
    search: (projectId: string, query: string) =>
      invoke<{ ok: boolean; hits: SearchHit[]; error?: string }>(IPC.fsSearch, projectId, query),
    symbols: (projectId: string) => invoke<ProjectSymbol[]>(IPC.fsSymbols, projectId)
  },
  agent: {
    send: (projectId: string, conversationId: string, text: string, opts?: SendOptions) =>
      invoke<{ ok: boolean; error?: string }>(IPC.agentSend, projectId, conversationId, text, opts),
    /** Sans conversation : arrête celle qui tourne dans le projet */
    stop: (projectId: string, conversationId?: string) => invoke<void>(IPC.agentStop, projectId, conversationId),
    approve: (projectId: string, conversationId: string, callId: string, ok: boolean) =>
      invoke<void>(IPC.agentApprove, projectId, conversationId, callId, ok),
    history: (projectId: string, conversationId: string) =>
      invoke<{ items: ChatItem[]; running: boolean; startedAt: number | null; usage: UsageTotals }>(IPC.agentHistory, projectId, conversationId),
    rewind: (projectId: string, conversationId: string, itemId: string, restoreCode: boolean) =>
      invoke<{
        ok: boolean
        error?: string
        text?: string
        images?: ImageAttachment[]
        mode?: AgentMode
        files?: { restored: number; removed: number }
        historyCut?: boolean
      }>(IPC.agentRewind, projectId, conversationId, itemId, restoreCode),
    onEvent: (cb: (e: AgentEvent) => void) => listen(IPC.agentEvent, cb)
  },
  conversations: {
    list: (projectId: string) => invoke<ConversationMeta[]>(IPC.convList, projectId),
    create: (projectId: string) => invoke<ConversationMeta>(IPC.convCreate, projectId),
    rename: (projectId: string, id: string, title: string) => invoke<void>(IPC.convRename, projectId, id, title),
    remove: (projectId: string, id: string) => invoke<{ ok: boolean; error?: string }>(IPC.convDelete, projectId, id)
  },
  proc: {
    list: (projectId?: string) => invoke<ProcessInfo[]>(IPC.procList, projectId),
    start: (projectId: string, label: string, command: string, cwd: string) =>
      invoke<ProcessInfo>(IPC.procStart, projectId, label, command, cwd),
    stop: (id: string) => invoke<void>(IPC.procStop, id),
    logs: (id: string) => invoke<string>(IPC.procLogs, id),
    onEvent: (cb: (e: ProcessEvent) => void) => listen(IPC.procEvent, cb)
  },
  deploy: { targets: () => invoke<DeployTarget[]>(IPC.deployTargets) },
  git: {
    status: (projectId: string) => invoke<GitStatus>(IPC.gitStatus, projectId),
    restore: (projectId: string, paths: string[]) => invoke<{ ok: boolean; error?: string }>(IPC.gitRestore, projectId, paths),
    clean: (projectId: string, paths: string[]) => invoke<{ ok: boolean; error?: string }>(IPC.gitClean, projectId, paths)
  },
  memory: {
    list: (projectId: string) => invoke<MemoryEntry[]>(IPC.memoryList, projectId),
    add: (projectId: string, category: MemoryCategory, text: string) => invoke<MemoryEntry>(IPC.memoryAdd, projectId, category, text),
    remove: (projectId: string, id: string) => invoke<boolean>(IPC.memoryDelete, projectId, id)
  },
  env: { check: () => invoke<Record<string, string | null>>(IPC.envCheck) },
  local: {
    info: () => invoke<MachineInfo>(IPC.localInfo),
    pull: (tag: string) => invoke<{ ok: boolean; proc?: ProcessInfo; error?: string }>(IPC.localPull, tag),
    use: (tag: string) => invoke<AppSettings>(IPC.localUse, tag)
  },
  util: {
    qr: (text: string) => invoke<string>(IPC.qrCode, text),
    openExternal: (url: string) => invoke<void>(IPC.openExternal, url),
    setTitleBarTheme: (dark: boolean) => invoke<void>(IPC.titleBarTheme, dark),
    platform: process.platform
  }
}

export type Api = typeof api
contextBridge.exposeInMainWorld('api', api)
