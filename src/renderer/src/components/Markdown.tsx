import { Fragment, type ReactNode } from 'react'

/** Rendu Markdown minimal et sûr (pas de HTML injecté) : blocs de code, titres, listes, gras, code inline, liens. */
export function Markdown({ text }: { text: string }) {
  const parts = text.split(/```/)
  return (
    <div className="md">
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          const nl = part.indexOf('\n')
          const code = nl === -1 ? part : part.slice(nl + 1)
          return (
            <pre key={i} className="code">
              <code>{code.replace(/\n$/, '')}</code>
            </pre>
          )
        }
        return <Fragment key={i}>{blocks(part)}</Fragment>
      })}
    </div>
  )
}

function blocks(src: string): ReactNode[] {
  const out: ReactNode[] = []
  let list: string[] = []
  const flush = (): void => {
    if (list.length) {
      out.push(
        <ul key={'l' + out.length}>
          {list.map((l, i) => (
            <li key={i}>{inline(l)}</li>
          ))}
        </ul>
      )
      list = []
    }
  }
  for (const line of src.split('\n')) {
    const li = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/)
    if (li) {
      list.push(li[1])
      continue
    }
    flush()
    const h = line.match(/^(#{1,4})\s+(.*)/)
    if (h) out.push(<div key={out.length} className={'h h' + h[1].length}>{inline(h[2])}</div>)
    else if (line.trim()) out.push(<p key={out.length}>{inline(line)}</p>)
  }
  flush()
  return out
}

function inline(s: string): ReactNode[] {
  const tokens = s.split(/(`[^`]+`|\*\*[^*]+\*\*|https?:\/\/[^\s)]+|exp:\/\/[^\s)]+)/g)
  return tokens.map((t, i) => {
    if (t.startsWith('`') && t.endsWith('`')) return <code key={i}>{t.slice(1, -1)}</code>
    if (t.startsWith('**') && t.endsWith('**')) return <b key={i}>{t.slice(2, -2)}</b>
    if (/^(https?|exp):\/\//.test(t))
      return (
        <a key={i} href="#" onClick={(e) => (e.preventDefault(), window.api.util.openExternal(t))}>
          {t}
        </a>
      )
    return <Fragment key={i}>{t}</Fragment>
  })
}
