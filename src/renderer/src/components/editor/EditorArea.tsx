import { Sparkles, X } from 'lucide-react'
import { actions, setState, useStore } from '../../store/appStore'
import { fileIcon } from '../ui'
import { CodeEditor } from './CodeEditor'
import { AgentPanel } from '../agent/AgentPanel'

export function EditorArea() {
  const current = useStore((s) => s.current)
  const openFiles = useStore((s) => s.openFiles)
  const active = useStore((s) => s.activeTab)
  const dirty = useStore((s) => s.dirtyFiles)
  const running = useStore((s) => s.agentRunning)
  if (!current) return null

  return (
    <section className="editor-area">
      <div className="tabbar">
        <button className={`tab-item agent${active === 'agent' ? ' active' : ''}`} onClick={() => setState({ activeTab: 'agent' })}>
          <Sparkles size={13} className={running ? 'pulse' : ''} />
          Agent
          {running && <span className="tab-live" />}
        </button>
        {openFiles.map((f) => {
          const name = f.split('/').pop() ?? f
          const { Icon, color } = fileIcon(name)
          const isDirty = dirty.includes(f)
          return (
            <div
              key={f}
              className={`tab-item${active === f ? ' active' : ''}`}
              onClick={() => setState({ activeTab: f })}
              onMouseDown={(e) => e.button === 1 && actions.closeFile(f)}
              title={f}
            >
              <Icon size={13} color={color} />
              <span>{name}</span>
              <button
                className={`tab-close${isDirty ? ' dirty' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  if (isDirty && !confirm(`${name} a des modifications non enregistrées. Fermer quand même ?`)) return
                  actions.closeFile(f)
                }}
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
      </div>
      <div className="editor-content">
        {/* Le panneau agent reste monté pour conserver le flux en direct */}
        <div className="editor-pane" style={{ display: active === 'agent' ? 'flex' : 'none' }}>
          <AgentPanel key={current.id} project={current} />
        </div>
        {openFiles.map((f) => (
          <div key={current.id + f} className="editor-pane" style={{ display: active === f ? 'flex' : 'none' }}>
            <CodeEditor projectId={current.id} path={f} />
          </div>
        ))}
      </div>
    </section>
  )
}
