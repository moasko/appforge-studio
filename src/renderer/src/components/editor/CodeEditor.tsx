import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror, { keymap, EditorView } from '@uiw/react-codemirror'
import { EditorState } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { Save, RotateCcw } from 'lucide-react'
import type { FileNode } from '@shared/types'
import { actions, setState, useStore } from '../../store/appStore'
import { IconButton } from '../ui'
import { pathSource, projectSymbolSource, snippetSource } from './completions'
import type { CompletionIndex } from './completions'

function languageFor(path: string) {
  const ext = path.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'ts':
      return [javascript({ typescript: true })]
    case 'tsx':
      return [javascript({ typescript: true, jsx: true })]
    case 'js':
    case 'mjs':
    case 'cjs':
      return [javascript()]
    case 'jsx':
      return [javascript({ jsx: true })]
    case 'json':
      return [json()]
    case 'css':
      return [css()]
    case 'html':
      return [html()]
    case 'md':
      return [markdown()]
    default:
      return []
  }
}

const baseTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--bg-editor)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-gutters': { backgroundColor: 'var(--bg-editor)', borderRight: '1px solid var(--line-soft)', color: 'var(--text-faint)' },
  '.cm-activeLineGutter, .cm-activeLine': { backgroundColor: 'var(--hover)' }
})

export function CodeEditor({ projectId, path }: { projectId: string; path: string }) {
  const theme = useStore((s) => s.settings?.theme ?? 'dark')
  const reveal = useStore((s) => s.pendingReveal)
  const [value, setValue] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [viewReady, setViewReady] = useState(false)
  const saved = useRef('')
  const valueRef = useRef('')
  const viewRef = useRef<EditorView | null>(null)

  const load = useCallback(async () => {
    try {
      const text = await window.api.fs.read(projectId, path)
      saved.current = text
      valueRef.current = text
      setValue(text)
      actions.setDirty(path, false)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [projectId, path])

  useEffect(() => {
    load()
    // Recharge automatiquement si l'agent modifie le fichier (et qu'il n'y a pas d'édition locale)
    const off = window.api.agent.onEvent((e) => {
      if (e.type === 'files-changed' && e.projectId === projectId && valueRef.current === saved.current) {
        window.api.fs
          .read(projectId, path)
          .then((t) => {
            if (t !== saved.current && valueRef.current === saved.current) {
              saved.current = t
              valueRef.current = t
              setValue(t)
            }
          })
          .catch(() => undefined)
      }
    })
    return off
  }, [load, projectId, path])

  // Après une recherche de contenu : sélectionne et centre la ligne demandée
  useEffect(() => {
    const view = viewRef.current
    if (!reveal || reveal.path !== path || value === null || !viewReady || !view) return
    const n = Math.min(Math.max(1, reveal.line), view.state.doc.lines)
    const line = view.state.doc.line(n)
    view.dispatch({
      selection: { anchor: line.from, head: line.to },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' })
    })
    view.focus()
    setState({ pendingReveal: null })
  }, [reveal, path, value, viewReady])

  const save = useCallback(async () => {
    await window.api.fs.write(projectId, path, valueRef.current)
    saved.current = valueRef.current
    actions.setDirty(path, false)
    actions.toast(`${path.split('/').pop()} enregistré`, 'success')
  }, [projectId, path])

  // Index d'autocomplétion : symboles exportés, fichiers, paquets des package.json
  const indexRef = useRef<CompletionIndex>({ symbols: [], files: [], packages: [] })
  const loadIndex = useCallback(async () => {
    try {
      const [symbols, tree] = await Promise.all([
        window.api.fs.symbols(projectId).catch(() => []),
        window.api.fs.tree(projectId).catch(() => [] as FileNode[])
      ])
      const files: string[] = []
      const visit = (nodes: FileNode[]): void => {
        for (const n of nodes) {
          if (n.type === 'file') files.push(n.path)
          else if (n.children) visit(n.children)
        }
      }
      visit(tree)
      const packages = new Set<string>()
      const manifests = files.filter((f) => /(^|\/)package\.json$/.test(f)).slice(0, 3)
      await Promise.all(
        manifests.map(async (m) => {
          try {
            const j = JSON.parse(await window.api.fs.read(projectId, m)) as Record<string, Record<string, string> | undefined>
            for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
              for (const name of Object.keys(j[field] ?? {})) packages.add(name)
            }
          } catch {
            /* manifeste illisible */
          }
        })
      )
      indexRef.current = { symbols, files, packages: [...packages] }
    } catch {
      /* index indisponible : la complétion standard reste active */
    }
  }, [projectId])

  useEffect(() => {
    loadIndex()
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = window.api.agent.onEvent((e) => {
      if (e.type !== 'files-changed' || e.projectId !== projectId) return
      clearTimeout(timer)
      timer = setTimeout(loadIndex, 1500)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [loadIndex, projectId])

  const extensions = useMemo(
    () => [
      ...languageFor(path),
      baseTheme,
      keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (save(), true) }]),
      // Sources ajoutées à celles du langage (mots locaux, CSS, HTML…) sans les remplacer.
      // Un objet par source : un tableau serait lu comme une liste d'options statiques.
      EditorState.languageData.of(() => [
        { autocomplete: pathSource(() => indexRef.current, () => path) },
        { autocomplete: projectSymbolSource(() => indexRef.current, () => path) },
        { autocomplete: snippetSource }
      ])
    ],
    [path, save]
  )

  if (error) return <div className="pane-empty">{error}</div>
  if (value === null) return <div className="pane-empty">Chargement…</div>

  return (
    <div className="code-editor">
      <div className="breadcrumbs">
        {path.split('/').map((seg, i, arr) => (
          <span key={i} className={i === arr.length - 1 ? 'crumb last' : 'crumb'}>
            {seg}
          </span>
        ))}
        <div className="grow" />
        <IconButton icon={RotateCcw} label="Recharger depuis le disque" size={13} onClick={load} />
        <IconButton icon={Save} label="Enregistrer" shortcut="Ctrl S" size={13} onClick={save} />
      </div>
      <CodeMirror
        value={value}
        height="100%"
        className="cm-host"
        theme={theme === 'dark' ? oneDark : 'light'}
        extensions={extensions}
        onCreateEditor={(view) => {
          viewRef.current = view
          setViewReady(true)
          // DEBUG TEMPORAIRE
          ;(window as unknown as Record<string, unknown>).__cmView = view
        }}
        basicSetup={{ foldGutter: true, highlightActiveLine: true, bracketMatching: true, autocompletion: true }}
        onChange={(v) => {
          valueRef.current = v
          actions.setDirty(path, v !== saved.current)
        }}
      />
    </div>
  )
}
