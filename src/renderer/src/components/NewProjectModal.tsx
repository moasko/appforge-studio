import { useState } from 'react'
import type { Project, ProjectStack } from '@shared/types'
import { ARCHITECTURES, architectureById, hasBackend, type AppArchitecture } from '@shared/architectures'

const EXAMPLES = [
  'Une app de gestion de tâches en équipe avec projets, assignation, échéances et notifications.',
  'Une app de livraison de repas : restaurants, menu, panier, commande et suivi de statut.',
  'Un carnet de dépenses personnelles avec catégories, budget mensuel et graphiques.',
  'Une app de réservation de rendez-vous pour un salon de coiffure avec espace admin.',
  'Un guide des randonnées de la région avec cartes, difficulté et favoris.'
]

type Choice = 'auto' | AppArchitecture

export function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Project, prompt: string) => void }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [arch, setArch] = useState<Choice>('auto')
  const [mobile, setMobile] = useState(true)
  const [busy, setBusy] = useState(false)

  const create = async (): Promise<void> => {
    if (!name.trim() || !desc.trim()) return
    setBusy(true)
    const backend = arch !== 'auto' && hasBackend(arch)
    const stack: ProjectStack = {
      mobile,
      architecture: arch,
      backend: backend ? 'hono-prisma' : 'none',
      database: arch === 'static' ? 'none' : 'sqlite',
      auth: backend
    }
    const project = await window.api.projects.create(name.trim(), stack)
    const archLine =
      arch === 'auto'
        ? '- Architecture : choisis la plus simple qui couvre ce besoin (static, local, api ou api-admin) selon tes règles, annonce ton choix et sa raison en une ligne, puis passe-la à scaffold_project.'
        : `- Architecture imposée : ${arch} (${architectureById(arch).label}). Passe-la à scaffold_project ; si elle ne couvre pas un besoin de la description, signale-le en une phrase.`
    const parts = [
      `Crée l'application complète « ${name.trim()} » de A à Z.`,
      '',
      `Description : ${desc.trim()}`,
      '',
      'Exigences :',
      archLine,
      mobile
        ? '- App mobile Expo (iOS + Android). Pas de template : conçois d’abord un plan de design propre à cette app (direction, palette, typo, écrans), enregistre-le avec memory_save (design), puis construis l’UI à partir de ce plan et d’un fichier de tokens theme.ts.'
        : '- Pas d’app mobile.',
      '- Utilise scaffold_project pour démarrer, puis implémente TOUTES les fonctionnalités.',
      '- Vérifie que tout compile et fonctionne (typecheck, bundling Expo, et selon l’architecture : endpoints de l’API, panneau d’administration).',
      '- Vérifie la conformité de l’UI au plan de design : aucune couleur hors theme.ts, quatre états par écran, contraste lisible, rendu correct à 360 px de large.',
      '- Lance à la fin ce qu’il faut pour tester (Expo, et l’API ou l’administration s’il y en a), pour que je puisse scanner le QR code.'
    ]
    onCreated(project, parts.filter(Boolean).join('\n'))
  }

  const selected = arch === 'auto' ? null : architectureById(arch)

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
        <label>
          Architecture
          <select value={arch} onChange={(e) => setArch(e.target.value as Choice)}>
            <option value="auto">L’agent choisit selon la description (recommandé)</option>
            {ARCHITECTURES.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <p className="arch-hint">
          {selected
            ? `${selected.stack} Pour : ${selected.examples}.`
            : 'Contenu fixe, base locale sur le téléphone, backend avec comptes, ou backend avec panneau d’administration : l’agent prend la plus simple qui couvre votre description et explique son choix.'}
        </p>
        <label className="check">
          <input type="checkbox" checked={mobile} onChange={(e) => setMobile(e.target.checked)} /> App mobile Expo
        </label>
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
