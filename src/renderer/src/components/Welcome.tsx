import { Plus, FolderOpen, Cpu, Sparkles, Smartphone, Server, Rocket, ShieldCheck, Hexagon } from 'lucide-react'
import { actions, setState, useStore } from '../store/appStore'
import { Kbd } from './ui'

const FEATURES = [
  { icon: Sparkles, title: 'Agent autonome', text: 'Planifie, code, teste et corrige sans interruption.' },
  { icon: Smartphone, title: 'Expo natif', text: 'iOS + Android, QR code Expo Go, aperçu web.' },
  { icon: Server, title: 'Backend + base', text: 'API Hono, Drizzle, auth JWT, SQLite → Turso.' },
  { icon: Rocket, title: 'Déploiement intégré', text: 'EAS, OTA, Fly.io, Railway, VPS, Vercel.' },
  { icon: Cpu, title: 'Toute IA', text: 'Claude, OpenAI, OpenRouter, Ollama, LM Studio.' },
  { icon: ShieldCheck, title: 'Sécurisé', text: 'Secrets chiffrés, garde-fous, sandbox projet.' }
]

export function Welcome() {
  const projects = useStore((s) => s.projects)

  const openFolder = async (): Promise<void> => {
    const dir = await window.api.projects.pickDirectory()
    if (!dir) return
    const p = await window.api.projects.open(dir)
    await actions.refreshProjects()
    actions.selectProject(p)
  }

  return (
    <main className="welcome">
      <div className="welcome-inner">
        <div className="welcome-logo">
          <Hexagon size={30} strokeWidth={2} />
        </div>
        <h1>AppForge Studio</h1>
        <p className="welcome-sub">L’atelier IA pour concevoir, livrer et héberger des apps mobiles complètes.</p>
        <div className="welcome-actions">
          <button className="btn primary lg" onClick={() => setState({ modal: 'new' })}>
            <Plus size={16} /> Nouvelle application <Kbd>Ctrl N</Kbd>
          </button>
          <button className="btn lg" onClick={openFolder}>
            <FolderOpen size={16} /> Ouvrir un dossier
          </button>
        </div>

        {projects.length > 0 && (
          <div className="welcome-recent">
            <div className="welcome-label">Récents</div>
            {projects.slice(0, 5).map((p) => (
              <button key={p.id} className="recent-item" onClick={() => actions.selectProject(p)}>
                <span className="recent-name">{p.name}</span>
                <span className="recent-path">{p.path}</span>
              </button>
            ))}
          </div>
        )}

        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="feature">
              <f.icon size={18} />
              <div>
                <div className="feature-title">{f.title}</div>
                <div className="feature-text">{f.text}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
