import { snippetCompletion } from '@codemirror/autocomplete'
import type { Completion, CompletionContext, CompletionSource } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import type { ProjectSymbol } from '@shared/types'

export interface CompletionIndex {
  symbols: ProjectSymbol[]
  /** Chemins de fichiers du projet (relatifs, séparateur '/'). */
  files: string[]
  /** Noms de paquets déclarés dans les package.json du projet. */
  packages: string[]
}

const SYMBOL_TYPE: Record<ProjectSymbol['kind'], string> = {
  function: 'function',
  class: 'class',
  variable: 'variable',
  type: 'type',
  enum: 'enum',
  default: 'variable'
}

const dirOf = (p: string): string => {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i)
}

/** Spécifieur d'import relatif entre deux fichiers du projet (extension et /index retirés). */
export function relativeSpecifier(fromFile: string, target: string): string {
  const from = dirOf(fromFile).split('/').filter(Boolean)
  const to = target.split('/')
  let i = 0
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++
  let spec = '../'.repeat(from.length - i) + to.slice(i).join('/')
  if (!spec.startsWith('.')) spec = './' + spec
  spec = spec.replace(/\.(tsx?|jsx?|mjs|cjs)$/, '').replace(/\/index$/, '')
  return spec || '.'
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function hasImportOf(doc: string, name: string): boolean {
  const n = escapeRe(name)
  return new RegExp(`import\\s*\\{[^}]*\\b${n}\\b[^}]*\\}`).test(doc) || new RegExp(`import\\b[^;\\n]*\\b${n}\\b[^;\\n]*from\\s*['"]`).test(doc)
}

/** Position d'insertion d'un nouvel import : après les directives et le bloc d'imports existant. */
export function importPosition(doc: string): number {
  let offset = 0
  let end = 0
  let inImport = false
  for (const line of doc.split('\n')) {
    const t = line.trim()
    const next = offset + line.length + 1
    if (inImport) {
      end = next
      if (/\bfrom\s*['"][^'"]*['"]\s*;?$/.test(t) || /^['"][^'"]+['"]\s*;?$/.test(t) || t.includes('}')) inImport = false
      offset = next
      continue
    }
    if (/^import\b/.test(t)) {
      end = next
      inImport = !/\bfrom\s*['"][^'"]*['"]\s*;?$/.test(t) && !/^import\s*['"][^'"]+['"]/.test(t)
      offset = next
      continue
    }
    if (t === '' || /^\/[/*]/.test(t) || /^\*/.test(t) || /^['"]use (client|strict)['"]/.test(t)) {
      if (end === 0) end = next
      offset = next
      continue
    }
    break
  }
  return end
}

function inStringOrComment(ctx: CompletionContext): boolean {
  let node = syntaxTree(ctx.state).resolveInner(ctx.pos, -1)
  for (let i = 0; i < 4 && node; i++, node = node.parent as typeof node) {
    if (/Comment|String|Template/.test(node.name)) return true
  }
  return false
}

function applySymbol(view: EditorView, sym: ProjectSymbol, curPath: string, from: number, to: number): void {
  const doc = view.state.doc.toString()
  const needImport = sym.path !== '' && !hasImportOf(doc, sym.name)
  if (!needImport) {
    view.dispatch({ changes: { from, to, insert: sym.name }, selection: { anchor: from + sym.name.length } })
    return
  }
  const pos = importPosition(doc)
  const spec = relativeSpecifier(curPath, sym.path)
  const stmt = (sym.kind === 'default' ? `import ${sym.name} from '${spec}'` : `import { ${sym.name} } from '${spec}'`) + '\n'
  const shift = from >= pos ? stmt.length : 0
  view.dispatch({
    changes: [
      { from: pos, insert: stmt },
      { from, to, insert: sym.name }
    ],
    selection: { anchor: from + shift + sym.name.length }
  })
}

/** Complétion des symboles exportés par les autres fichiers du projet, avec import automatique. */
export function projectSymbolSource(get: () => CompletionIndex, currentPath: () => string): CompletionSource {
  return (ctx) => {
    console.log('[ac] symbols source, explicit=' + ctx.explicit)
    const word = ctx.matchBefore(/[A-Za-z_$][\w$]*$/)
    if (!word && !ctx.explicit) return null
    if (word && word.from > 0 && ctx.state.sliceDoc(word.from - 1, word.from) === '.') return null
    if (inStringOrComment(ctx)) return null
    const data = get()
    if (!data.symbols.length) return null
    const from = word ? word.from : ctx.pos
    const prefix = ctx.state.sliceDoc(from, ctx.pos).toLowerCase()
    const cur = currentPath()
    const curDir = dirOf(cur)
    const options: Completion[] = []
    for (const sym of data.symbols) {
      if (sym.path === cur) continue
      if (prefix && !sym.name.toLowerCase().startsWith(prefix)) continue
      options.push({
        label: sym.name,
        type: SYMBOL_TYPE[sym.kind],
        detail: sym.path + ':' + sym.line,
        boost: dirOf(sym.path) === curDir ? 3 : 0,
        apply: (view, _completion, f, t) => applySymbol(view, sym, cur, f, t)
      })
      if (options.length >= 200) break
    }
    console.log('[ac] symbols -> ' + options.length + ' options: ' + options.slice(0, 3).map((o) => o.label).join(','))
    if (!options.length) return null
    return { from, options, validFor: /^[\w$]*$/ }
  }
}

/** Complétion des chemins de fichiers et des paquets npm à l'intérieur des import/require. */
export function pathSource(get: () => CompletionIndex, currentPath: () => string): CompletionSource {
  return (ctx) => {
    const m = ctx.matchBefore(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"][^'"]*$/)
    if (!m) return null
    const text = m.text
    const quote = Math.max(text.lastIndexOf("'"), text.lastIndexOf('"'))
    const partial = text.slice(quote + 1)
    if (!/^[\w./@-]*$/.test(partial)) return null
    const from = m.from + quote + 1
    const cur = currentPath()
    const data = get()
    const byLabel = new Map<string, Completion>()
    const add = (c: Completion): void => {
      if (!byLabel.has(c.label)) byLabel.set(c.label, c)
    }
    for (const file of data.files) {
      if (!/\.(ts|tsx|js|jsx|mjs|cjs|json|css)$/.test(file) || file === cur) continue
      if (/\/(?:index)\.(?:tsx?|jsx?)$/.test(file)) {
        add({ label: relativeSpecifier(cur, file.replace(/\/index\.[a-z]+$/, '')), type: 'namespace', detail: 'dossier', boost: 2 })
      }
      add({ label: relativeSpecifier(cur, file), type: 'text', detail: file })
    }
    for (const pkg of data.packages) add({ label: pkg, type: 'namespace', detail: 'paquet installé', boost: 1 })
    const rel = partial === '' || partial.startsWith('.')
    const options = [...byLabel.values()].filter((o) => (rel ? o.type !== 'namespace' || o.detail === 'dossier' : true) && o.label.startsWith(partial))
    if (!options.length) return null
    return { from, options: options.slice(0, 80), validFor: /^[\w./@-]*$/ }
  }
}

const SNIPPETS: Completion[] = [
  snippetCompletion('console.log(${})', { label: 'clg', detail: 'console.log', type: 'text' }),
  snippetCompletion('try {\n\t${}\n} catch (err) {\n\tconsole.error(err)\n}', { label: 'tryc', detail: 'try / catch', type: 'keyword' }),
  snippetCompletion('async () => {\n\t${}\n}', { label: 'afn', detail: 'fonction fléchée async', type: 'function' }),
  snippetCompletion("useEffect(() => {\n\t${}\n}, [])", { label: 'uef', detail: 'useEffect', type: 'function' })
]

export const snippetSource: CompletionSource = (ctx) => {
  const word = ctx.matchBefore(/[A-Za-z]*$/)
  if (!word || (word.from === word.to && !ctx.explicit)) return null
  if (inStringOrComment(ctx)) return null
  const options = SNIPPETS.filter((s) => String(s.label).startsWith(word.text))
  return options.length ? { from: word.from, options, validFor: /^\w*$/ } : null
}
