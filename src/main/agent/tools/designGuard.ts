/**
 * Garde-fou de conception : les fichiers d'écran du projet mobile ne doivent pas
 * contenir de couleur littérale. Seuls les fichiers de thème peuvent en déclarer.
 * Pur : aucune dépendance fs, testable directement.
 */

export interface HexHit {
  value: string
  line: number
}

const HEX_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![\w])/g

const rel = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '')

/** Fichier de thème : mobile/lib/theme.ts, mobile/theme/tokens.ts, mobile/lib/colors.ts… */
export function isThemePath(p: string): boolean {
  const path = rel(p)
  if (!path.startsWith('mobile/')) return false
  const rest = path.slice('mobile/'.length)
  if (/^(theme|tokens|colors)\.[jt]sx?$/.test(rest)) return true
  if (/(^|\/)(theme|tokens)\//.test(rest)) return true
  return /^(lib|src\/lib)\/(theme|tokens|colors)\.[jt]sx?$/.test(rest)
}

/** Fichier d'interface mobile : écrans, composants, layouts. */
export function isUiPath(p: string): boolean {
  const path = rel(p)
  if (!path.startsWith('mobile/')) return false
  const rest = path.slice('mobile/'.length)
  if (!/\.[jt]sx?$/.test(rest)) return false
  return /^(app|src\/app|components|src\/components|screens|src\/screens|ui|src\/ui)\//.test(rest)
}

export function findHexColors(text: string): HexHit[] {
  const hits: HexHit[] = []
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(HEX_RE)) hits.push({ value: m[0], line: i + 1 })
  })
  return hits
}

/** Retourne un message d'erreur si le contenu viole la règle, sinon null. */
export function guardHex(relPath: string, content: string): string | null {
  if (!isUiPath(relPath) || isThemePath(relPath)) return null
  const hits = findHexColors(content)
  if (!hits.length) return null
  const list = hits
    .slice(0, 8)
    .map((h) => `${h.value} (ligne ${h.line})`)
    .join(', ')
  const more = hits.length > 8 ? ` et ${hits.length - 8} autre(s)` : ''
  return (
    `Écriture refusée : couleur(s) hexadécimale(s) dans ${rel(relPath)} — ${list}${more}. ` +
    'Les écrans utilisent uniquement les tokens de mobile/lib/theme.ts (ex. theme.colors.accent) ; ' +
    'ajoute la variante au thème si elle manque, puis référence-la.'
  )
}
