export interface DiffRow {
  kind: 'ctx' | 'del' | 'add'
  oldNo: number | null
  newNo: number | null
  text: string
}

const CONTEXT = 3
/** Au-delà, on renonce au LCS et on affiche bloc supprimé puis bloc ajouté. */
const MAX_DP_CELLS = 250_000

/** Diff ligne à ligne (LCS) après rognage du préfixe/suffixe commun. */
export function diffRows(oldText: string, newText: string): DiffRow[] {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length - 1
  let endB = b.length - 1
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--
    endB--
  }

  const rows: DiffRow[] = []
  for (let i = 0; i < start; i++) rows.push({ kind: 'ctx', oldNo: i + 1, newNo: i + 1, text: a[i] })

  const midA = a.slice(start, endA + 1)
  const midB = b.slice(start, endB + 1)
  if (midA.length * midB.length > MAX_DP_CELLS) {
    midA.forEach((t, i) => rows.push({ kind: 'del', oldNo: start + i + 1, newNo: null, text: t }))
    midB.forEach((t, i) => rows.push({ kind: 'add', oldNo: null, newNo: start + i + 1, text: t }))
  } else {
    const n = midA.length
    const m = midB.length
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        rows.push({ kind: 'ctx', oldNo: start + i + 1, newNo: start + j + 1, text: midA[i] })
        i++
        j++
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        rows.push({ kind: 'del', oldNo: start + i + 1, newNo: null, text: midA[i] })
        i++
      } else {
        rows.push({ kind: 'add', oldNo: null, newNo: start + j + 1, text: midB[j] })
        j++
      }
    }
    while (i < n) rows.push({ kind: 'del', oldNo: start + i + 1, newNo: null, text: midA[i++] })
    while (j < m) rows.push({ kind: 'add', oldNo: null, newNo: start + j + 1, text: midB[j++] })
  }

  for (let i = endA + 1; i < a.length; i++) rows.push({ kind: 'ctx', oldNo: i + 1, newNo: endB + i - endA + 1, text: a[i] })
  return rows
}

/** Ne garde que les changements et CONTEXT lignes autour, en hunks séparés. */
export function diffHunks(rows: DiffRow[]): DiffRow[][] {
  const keep = new Set<number>()
  rows.forEach((r, i) => {
    if (r.kind === 'ctx') return
    for (let k = Math.max(0, i - CONTEXT); k <= Math.min(rows.length - 1, i + CONTEXT); k++) keep.add(k)
  })
  const hunks: DiffRow[][] = []
  let cur: DiffRow[] = []
  for (let i = 0; i < rows.length; i++) {
    if (!keep.has(i)) {
      if (cur.length) hunks.push(cur)
      cur = []
      continue
    }
    cur.push(rows[i])
  }
  if (cur.length) hunks.push(cur)
  return hunks
}

export function hunkHeader(rows: DiffRow[]): string {
  const olds = rows.map((r) => r.oldNo).filter((n): n is number => n !== null)
  const news = rows.map((r) => r.newNo).filter((n): n is number => n !== null)
  return `@@ -${olds[0] ?? 0},${olds.length} +${news[0] ?? 0},${news.length} @@`
}
