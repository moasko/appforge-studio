import { app, BrowserWindow, shell } from 'electron'
import path from 'path'
import { registerIpc } from './ipc'
import { processManager } from './services/processManager'
import { detectLocalProviders } from './services/localDetect'

let win: BrowserWindow | null = null

// DEBUG TEMPORAIRE
if (!app.isPackaged) app.commandLine.appendSwitch('remote-debugging-port', '9223')

function createWindow(): void {
  win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#0b0d12',
    title: 'AppForge Studio',
    autoHideMenuBar: true,
    // Barre de titre intégrée à l'interface (boutons natifs conservés)
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 14, y: 13 } }
      : { titleBarOverlay: { color: '#0b0d12', symbolColor: '#9aa3b5', height: 40 } }),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win?.show())
  // Les liens externes s'ouvrent dans le navigateur, pas dans l'app
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  // Détecte LM Studio / Ollama avant que l'interface ne lise les réglages
  await detectLocalProviders().catch(() => undefined)
  const agents = registerIpc(() => win)
  createWindow()
  // Missions interrompues (crash/arrêt brutal) : l'agent reprend seul une fois l'UI prête
  setTimeout(() => {
    const n = agents.resumeInterrupted()
    if (n) console.log(`[agent] ${n} mission(s) reprise(s) automatiquement`)
  }, 5000)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  app.on('before-quit', () => {
    agents.stopAll()
    processManager.stopAll()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
