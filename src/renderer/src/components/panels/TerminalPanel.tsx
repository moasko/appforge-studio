import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Square, Trash2, X, ChevronRight, TerminalSquare } from 'lucide-react'
import { setState, useStore } from '../../store/appStore'
import { useProcesses } from '../../hooks/useProcesses'
import { Dot, IconButton } from '../ui'

const THEME_DARK = {
  background: '#0b0d12',
  foreground: '#c9d1e0',
  cursor: '#8b7bff',
  selectionBackground: '#3a3f5a',
  black: '#1b1f2a',
  green: '#3ecf8e',
  red: '#f45b69',
  yellow: '#f5c451',
  blue: '#5ea8ff',
  magenta: '#b48cff',
  cyan: '#4fd1d9'
}
const THEME_LIGHT = { background: '#fbfbfd', foreground: '#1f2430', cursor: '#6246ea', selectionBackground: '#d6d9f2' }

export function TerminalPanel() {
  const current = useStore((s) => s.current)
  const theme = useStore((s) => s.settings?.theme ?? 'dark')
  const height = useStore((s) => s.sizes.bottom)
  const procs = useProcesses(current?.id ?? '')
  const [selected, setSelected] = useState<string | null>(null)
  const [cmd, setCmd] = useState('')
  const [cwd, setCwd] = useState('')
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)

  const sel = procs.find((p) => p.id === selected) ?? procs[procs.length - 1]

  // Création unique du terminal
  useEffect(() => {
    if (!host.current) return
    const t = new Terminal({
      convertEol: true,
      disableStdin: true,
      fontFamily: '"JetBrains Mono Variable", Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.35,
      scrollback: 8000,
      theme: theme === 'dark' ? THEME_DARK : THEME_LIGHT
    })
    const f = new FitAddon()
    t.loadAddon(f)
    t.open(host.current)
    term.current = t
    fit.current = f
    const ro = new ResizeObserver(() => {
      try {
        f.fit()
      } catch {
        /* panneau masqué */
      }
    })
    ro.observe(host.current)
    return () => {
      ro.disconnect()
      t.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (term.current) term.current.options.theme = theme === 'dark' ? THEME_DARK : THEME_LIGHT
  }, [theme])

  useEffect(() => {
    try {
      fit.current?.fit()
    } catch {
      /* ignore */
    }
  }, [height])

  // Affichage du processus sélectionné + flux en direct
  useEffect(() => {
    const t = term.current
    if (!t) return
    // Séquence d'effacement via la file d'écriture (reset() est synchrone et passerait avant les écritures en attente)
    t.write('\x1bc')
    if (!sel) {
      t.writeln('\x1b[90mAucun service. Lancez une commande ci-dessous ou demandez à l’agent.\x1b[0m')
      return
    }
    t.writeln(`\x1b[35m❯\x1b[0m \x1b[1m${sel.command}\x1b[0m  \x1b[90m${sel.cwd}\x1b[0m`)
    window.api.proc.logs(sel.id).then((l) => t.write(l))
    const off = window.api.proc.onEvent((e) => {
      if (e.type === 'output' && e.id === sel.id) t.write(e.chunk)
    })
    return off
  }, [sel?.id])

  const run = async (): Promise<void> => {
    if (!current || !cmd.trim()) return
    const label = cmd.trim().split(/\s+/).slice(0, 2).join(' ').slice(0, 20)
    const info = await window.api.proc.start(current.id, label, cmd.trim(), cwd.trim())
    setSelected(info.id)
    setCmd('')
  }

  return (
    <section className="bottom-panel" style={{ height }}>
      <div className="bp-header">
        <div className="bp-tabs">
          <span className="bp-title">
            <TerminalSquare size={13} /> Terminal
          </span>
          {procs.map((p) => (
            <button key={p.id} className={`bp-tab${sel?.id === p.id ? ' active' : ''}`} onClick={() => setSelected(p.id)}>
              <Dot state={p.status === 'running' ? 'on' : p.status === 'error' ? 'err' : 'off'} />
              {p.label}
            </button>
          ))}
        </div>
        <div className="bp-actions">
          {sel?.status === 'running' && <IconButton icon={Square} label="Arrêter" size={13} onClick={() => window.api.proc.stop(sel.id)} />}
          <IconButton icon={Trash2} label="Effacer l'affichage" size={13} onClick={() => term.current?.clear()} />
          <IconButton icon={X} label="Fermer le panneau" shortcut="Ctrl J" size={14} onClick={() => setState({ bottomOpen: false })} />
        </div>
      </div>
      <div className="bp-term" ref={host} />
      <div className="bp-input">
        <ChevronRight size={14} className="bp-prompt" />
        <input className="bp-cwd" placeholder="dossier" value={cwd} onChange={(e) => setCwd(e.target.value)} />
        <input
          className="bp-cmd"
          placeholder="npm test, npx expo install expo-camera, git status…"
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
        />
      </div>
    </section>
  )
}
