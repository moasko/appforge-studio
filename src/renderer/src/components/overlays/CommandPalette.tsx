import { useEffect, useMemo, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Search, Plus, Settings, Play, Smartphone, Server, PanelLeft, PanelBottom, PanelRight, Sun, Moon, Rocket, Bug, Sparkles, FolderOpen,
  GitCommit, Eraser, Square, Files, Activity, FolderKanban, FileText, Brain
} from 'lucide-react'
import { actions, flattenTree, getState, setState, useStore } from '../../store/appStore'
import { Kbd, fileIcon } from '../ui'

interface Command {
  id: string
  title: string
  group: string
  icon: LucideIcon
  iconColor?: string
  hint?: string
  subtitle?: string
  run: () => void
}

/** Score flou simple : toutes les lettres dans l'ordre, bonus pour les correspondances contiguës */
function fuzzy(q: string, text: string): number {
  if (!q) return 1
  const t = text.toLowerCase()
  const s = q.toLowerCase()
  if (t.includes(s)) return 100 - t.indexOf(s)
  let ti = 0
  let score = 0
  for (const ch of s) {
    const found = t.indexOf(ch, ti)
    if (found === -1) return 0
    score += found === ti ? 3 : 1
    ti = found + 1
  }
  return score
}

export function CommandPalette() {
  const modal = useStore((s) => s.modal)
  const tree = useStore((s) => s.tree)
  const current = useStore((s) => s.current)
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const [content, setContent] = useState<Command[]>([])
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (modal === 'palette') {
      setQ('')
      setIdx(0)
      setTimeout(() => input.current?.focus(), 0)
    }
  }, [modal])

  const close = (): void => setState({ modal: null })

  const commands = useMemo<Command[]>(() => {
    const start = (label: string, cmd: string, cwd: string) => () => {
      if (!current) return
      window.api.proc.start(current.id, label, cmd, cwd)
      setState({ bottomOpen: true })
    }
    const agent = (prompt: string) => () => actions.runAgent(prompt)
    const base: Command[] = [
      { id: 'new', title: 'Nouvelle application', group: 'Projet', icon: Plus, hint: 'Ctrl N', run: () => setState({ modal: 'new' }) },
      {
        id: 'open',
        title: 'Ouvrir un dossier existant',
        group: 'Projet',
        icon: FolderOpen,
        run: async () => {
          const dir = await window.api.projects.pickDirectory()
          if (!dir) return
          const p = await window.api.projects.open(dir)
          await actions.refreshProjects()
          actions.selectProject(p)
        }
      },
      { id: 'settings', title: 'Réglages et fournisseurs IA', group: 'Projet', icon: Settings, hint: 'Ctrl ,', run: () => setState({ modal: 'settings' }) }
    ]
    if (current) {
      base.push(
        { id: 'run-api', title: 'Démarrer l’API', group: 'Exécuter', icon: Server, run: start('api', 'npm run dev', 'api') },
        { id: 'run-expo', title: 'Démarrer Expo (LAN)', group: 'Exécuter', icon: Smartphone, run: start('mobile', 'npx expo start --lan', 'mobile') },
        { id: 'run-tunnel', title: 'Démarrer Expo (tunnel)', group: 'Exécuter', icon: Smartphone, run: start('mobile', 'npx expo start --tunnel', 'mobile') },
        { id: 'stop', title: 'Arrêter l’agent', group: 'Agent', icon: Square, hint: 'Échap', run: () => window.api.agent.stop(current.id) },
        { id: 'a-fix', title: 'Vérifier et corriger tout le projet', group: 'Agent', icon: Bug, run: agent('Vérifie tout le projet (types, bundling Expo, endpoints API) et corrige toutes les erreurs.') },
        { id: 'a-run', title: 'Lancer l’environnement complet', group: 'Agent', icon: Play, run: agent('Lance l’API et Expo, vérifie que tout fonctionne et donne-moi le QR code.') },
        { id: 'a-apk', title: 'Construire un APK Android', group: 'Agent', icon: Rocket, run: agent('Prépare et lance un build APK Android avec EAS (profil preview).') },
        { id: 'a-commit', title: 'Commiter les changements', group: 'Agent', icon: GitCommit, run: agent('Fais un commit git propre de tous les changements avec un message descriptif.') },
        { id: 'a-memory', title: 'Consulter la mémoire du projet', group: 'Agent', icon: Brain, run: () => setState({ modal: 'memory' }) },
        { id: 'a-review', title: 'Revue de code et améliorations', group: 'Agent', icon: Sparkles, run: agent('Fais une revue du code (sécurité, performance, UX) et applique les améliorations importantes.') },
        {
          id: 'clear',
          title: 'Nouvelle conversation',
          group: 'Agent',
          icon: Eraser,
          run: async () => {
            await window.api.agent.clear(current.id)
            actions.toast('Conversation effacée — rechargez l’onglet Agent', 'info')
          }
        }
      )
    }
    base.push(
      { id: 'v-exp', title: 'Afficher l’explorateur', group: 'Affichage', icon: Files, run: () => setState({ sideView: 'explorer' }) },
      { id: 'v-proj', title: 'Afficher les projets', group: 'Affichage', icon: FolderKanban, run: () => setState({ sideView: 'projects' }) },
      { id: 'v-svc', title: 'Afficher les services', group: 'Affichage', icon: Activity, run: () => setState({ sideView: 'processes' }) },
      { id: 'v-dep', title: 'Afficher le déploiement', group: 'Affichage', icon: Rocket, run: () => setState({ sideView: 'deploy' }) },
      { id: 'v-side', title: 'Basculer la barre latérale', group: 'Affichage', icon: PanelLeft, hint: 'Ctrl B', run: () => setState((s) => ({ sideView: s.sideView ? null : 'explorer' })) },
      { id: 'v-term', title: 'Basculer le terminal', group: 'Affichage', icon: PanelBottom, hint: 'Ctrl J', run: () => setState((s) => ({ bottomOpen: !s.bottomOpen })) },
      { id: 'v-prev', title: 'Basculer l’aperçu', group: 'Affichage', icon: PanelRight, hint: 'Ctrl P', run: () => setState((s) => ({ previewOpen: !s.previewOpen })) },
      {
        id: 'theme',
        title: 'Changer de thème clair / sombre',
        group: 'Affichage',
        icon: getState().settings?.theme === 'dark' ? Sun : Moon,
        run: () => actions.saveSettings({ theme: getState().settings?.theme === 'dark' ? 'light' : 'dark' })
      }
    )
    for (const p of getState().projects) {
      if (p.id !== current?.id) base.push({ id: 'p-' + p.id, title: `Basculer vers ${p.name}`, group: 'Projets', icon: FolderKanban, run: () => actions.selectProject(p) })
    }
    for (const f of flattenTree(tree)) {
      const { Icon, color } = fileIcon(f.split('/').pop() ?? f)
      base.push({ id: 'f-' + f, title: f, group: 'Fichiers', icon: Icon, iconColor: color, run: () => actions.openFile(f) })
    }
    return base
  }, [tree, current])

  // Recherche plein-texte (debounce) : résultats affichés sous le groupe « Contenu »
  useEffect(() => {
    const query = q.trim()
    if (modal !== 'palette' || !current || q.startsWith('>') || query.length < 2) {
      setContent([])
      return
    }
    let cancelled = false
    const t = setTimeout(async () => {
      const r = await window.api.fs.search(current.id, query)
      if (cancelled) return
      if (!r.ok) return setContent([])
      setContent(
        r.hits.map((h) => ({
          id: `c-${h.path}-${h.line}`,
          title: h.path,
          subtitle: `${h.line} · ${h.text}`,
          group: 'Contenu',
          icon: FileText,
          run: () => actions.openFileAt(h.path, h.line)
        }))
      )
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [q, modal, current])

  const results = useMemo(() => {
    const query = q.startsWith('>') ? q.slice(1).trim() : q.trim()
    const onlyCmds = q.startsWith('>')
    const cmds = commands
      .filter((c) => !(onlyCmds && c.group === 'Fichiers'))
      .map((c) => ({ c, score: fuzzy(query, c.title) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => (query ? b.score - a.score : 0))
      .slice(0, query ? 60 : 40)
      .map((x) => x.c)
    return [...cmds, ...content]
  }, [q, commands, content])

  useEffect(() => {
    list.current?.querySelector('.pal-item.active')?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  if (modal !== 'palette') return null

  const exec = (c?: Command): void => {
    if (!c) return
    close()
    c.run()
  }

  let lastGroup = ''
  return (
    <div className="overlay" onMouseDown={close}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pal-input">
          <Search size={15} />
          <input
            ref={input}
            value={q}
            placeholder="Rechercher un fichier ou du contenu… ou « > » pour les commandes"
            onChange={(e) => {
              setQ(e.target.value)
              setIdx(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIdx((i) => Math.min(results.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIdx((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') exec(results[idx])
              else if (e.key === 'Escape') close()
            }}
          />
          <Kbd>Échap</Kbd>
        </div>
        <div className="pal-list" ref={list}>
          {results.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null
            lastGroup = c.group
            return (
              <div key={c.id}>
                {header && <div className="pal-group">{header}</div>}
                <div className={`pal-item${i === idx ? ' active' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => exec(c)}>
                  <c.icon size={14} color={c.iconColor} />
                  <span className="pal-title">{c.title}</span>
                  {c.subtitle && <span className="pal-sub">{c.subtitle}</span>}
                  {c.hint && <Kbd>{c.hint}</Kbd>}
                </div>
              </div>
            )
          })}
          {!results.length && <div className="pal-empty">Aucun résultat</div>}
        </div>
        <div className="pal-footer">
          <span>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> naviguer
          </span>
          <span>
            <Kbd>↵</Kbd> ouvrir
          </span>
          <span>
            <Kbd>&gt;</Kbd> commandes
          </span>
        </div>
      </div>
    </div>
  )
}
