// Noms des canaux IPC centralisés : un seul endroit à modifier.
export const IPC = {
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  providerUpsert: 'provider:upsert',
  providerDelete: 'provider:delete',
  providerTest: 'provider:test',
  providerModels: 'provider:models',

  projectsList: 'projects:list',
  projectCreate: 'projects:create',
  projectOpen: 'projects:open',
  projectRemove: 'projects:remove',
  pickDirectory: 'dialog:pickDirectory',
  openExternal: 'shell:openExternal',
  openInExplorer: 'shell:openInExplorer',

  fsTree: 'fs:tree',
  fsRead: 'fs:read',
  fsWrite: 'fs:write',
  fsSearch: 'fs:search',
  fsSymbols: 'fs:symbols',

  agentSend: 'agent:send',
  agentStop: 'agent:stop',
  agentApprove: 'agent:approve',
  agentHistory: 'agent:history',
  agentRewind: 'agent:rewind',
  convList: 'conv:list',
  convCreate: 'conv:create',
  convRename: 'conv:rename',
  convDelete: 'conv:delete',
  agentEvent: 'agent:event',

  procList: 'proc:list',
  procStart: 'proc:start',
  procStop: 'proc:stop',
  procLogs: 'proc:logs',
  procEvent: 'proc:event',

  deployTargets: 'deploy:targets',
  envCheck: 'env:check',
  qrCode: 'util:qrcode',
  projectInfo: 'projects:info',
  titleBarTheme: 'ui:titleBarTheme',

  gitStatus: 'git:status',
  gitRestore: 'git:restore',
  gitClean: 'git:clean',

  memoryList: 'memory:list',
  memoryAdd: 'memory:add',
  memoryDelete: 'memory:delete',

  localInfo: 'local:info',
  localPull: 'local:pull',
  localUse: 'local:use'
} as const
