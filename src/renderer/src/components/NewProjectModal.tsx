import { useState } from 'react'
import type { Project } from '@shared/types'

const EXAMPLES = [
  'Une app de gestion de tâches en équipe avec projets, assignation, échéances et notifications.',
  'Une app de livraison de repas : restaurants, menu, panier, commande et suivi de statut.',
  'Un carnet de dépenses personnelles avec catégories, budget mensuel et graphiques.',
  'Une app de réservation de rendez-vous pour un salon de coiffure avec espace admin.'
]

export function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Project, prompt: string) => void }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [mobile, setMobile] = useState(true)
  const [backend, setBackend] = useState(true)
  const [auth, setAuth] = useState(true)
  const [busy, setBusy] = useState(false)

  const create = async (): Promise<void> => {
    if (!name.trim() || !desc.trim()) return
    setBusy(true)
    const project = await window.api.projects.create(name.trim(), {
      mobile,
      backend: backend ? 'hono-prisma' : 'none',
      database: backend ? 'sqlite' : 'none',
      auth
    })
    const parts = [
      `Crée l'application complète « ${name.trim()} » de A à Z.`,
      '',
      `Description : ${desc.trim()}`,
      '',
      'Exigences :',
      mobile ? '- App mobile Expo (iOS + Android). Pas de template : conçois d’abord un plan de design propre à cette app (direction, palette, typo, écrans), enregistre-le avec memory_save (design), puis construis l’UI à partir de ce plan et d’un fichier de tokens theme.ts.' : '- Pas d’app mobile.',
      backend ? '- Backend API + base de données, avec toutes les entités et routes nécessaires.' : '- Pas de backend : données locales sur l’appareil.',
      auth && backend ? '- Authentification (inscription / connexion) avec token sécurisé.' : '',
      '- Utilise scaffold_project pour démarrer, puis implémente TOUTES les fonctionnalités.',
      '- Vérifie que tout compile et fonctionne (typecheck, tests des endpoints, bundling Expo).',
      '- Vérifie la conformité de l’UI au plan de design : aucune couleur hors theme.ts, quatre états par écran, contraste lisible, rendu correct à 360 px de large.',
      '- Lance à la fin l’API et Expo pour que je puisse scanner le QR code.'
    ]
    onCreated(project, parts.filter(Boolean).join('\n'))
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Nouvelle application</h2>
        <label>
          Nom
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="ex : TaskFlow" />
        </label>
        <label>
          Que doit faire l’app ?
          <textarea rows={6} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Décrivez les fonctionnalités, les écrans, les utilisateurs…" />
        </label>
        <div className="chips">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip" onClick={() => setDesc(ex)}>
              {ex.slice(0, 48)}…
            </button>
          ))}
        </div>
        <div className="row gap">
          <label className="check">
            <input type="checkbox" checked={mobile} onChange={(e) => setMobile(e.target.checked)} /> App mobile Expo
          </label>
          <label className="check">
            <input type="checkbox" checked={backend} onChange={(e) => setBackend(e.target.checked)} /> Backend + base de données
          </label>
          <label className="check">
            <input type="checkbox" checked={auth} disabled={!backend} onChange={(e) => setAuth(e.target.checked)} /> Authentification
          </label>
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" disabled={busy || !name.trim() || !desc.trim()} onClick={create}>
            Créer et lancer l’agent
          </button>
        </div>
      </div>
    </div>
  )
}
