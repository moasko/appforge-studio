/**
 * Parseur et applicateur du format `apply_patch` (*** Begin Patch ... *** End Patch).
 * Pur : aucune dépendance fs, testable directement.
 */

export interface PatchLine {
  sign: ' ' | '+' | '-'
  text: string
}

export interface PatchOperation {
  kind: 'add' | 'delete' | 'update'
  path: string
  moveTo?: string
  hunks: PatchLine[][]
  added: number
  removed: number
}

export function parsePatch(raw: string): PatchOperation[] {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n')
  let started = false
  let ended = false
  const ops: PatchOperation[] = []
  let cur: PatchOperation | null = null
  let hunk: PatchLine[] | null = null

  const closeHunk = (): void => {
    if (cur && hunk && hunk.length) cur.hunks.push(hunk)
    hunk = null
  }

  for (const line of lines) {
    if (!started) {
      if (line.startsWith('*** Begin Patch')) started = true
      continue
    }
    if (line.startsWith('*** End Patch')) {
      closeHunk()
      ended = true
      break
    }
    if (line.startsWith('*** Add File:')) {
      closeHunk()
      const path = line.slice('*** Add File:'.length).trim()
      cur = { kind: 'add', path, hunks: [], added: 0, removed: 0 }
      hunk = []
      ops.push(cur)
      continue
    }
    if (line.startsWith('*** Delete File:')) {
      closeHunk()
      const path = line.slice('*** Delete File:'.length).trim()
      cur = { kind: 'delete', path, hunks: [], added: 0, removed: 0 }
      ops.push(cur)
      continue
    }
    if (line.startsWith('*** Update File:')) {
      closeHunk()
      const path = line.slice('*** Update File:'.length).trim()
      cur = { kind: 'update', path, hunks: [], added: 0, removed: 0 }
      ops.push(cur)
      continue
    }
    if (line.startsWith('*** Move to:')) {
      if (!cur || cur.kind !== 'update') throw new Error('*** Move to: sans *** Update File:')
      cur.moveTo = line.slice('*** Move to:'.length).trim()
      continue
    }
    if (!cur) continue
    if (line.startsWith('@@')) {
      closeHunk()
      hunk = []
      continue
    }
    if (cur.kind === 'add') {
      if (line.startsWith('+')) {
        hunk!.push({ sign: '+', text: line.slice(1) })
        cur.added++
      } else if (line.trim()) {
        throw new Error(`Ligne invalide dans Add File (${cur.path}): ${line.slice(0, 80)}`)
      }
      continue
    }
    if (cur.kind === 'delete') continue
    if (!hunk) hunk = []
    const sign = line[0]
    if (sign === ' ' || sign === '+' || sign === '-') {
      hunk.push({ sign: sign as ' ' | '+' | '-', text: line.slice(1) })
      if (sign === '+') cur.added++
      if (sign === '-') cur.removed++
    } else if (line.trim() === '') {
      hunk.push({ sign: ' ', text: '' })
    } else {
      throw new Error(`Ligne invalide dans le patch (${cur.path}): ${line.slice(0, 80)}`)
    }
  }

  if (!started) throw new Error('Patch invalide : "*** Begin Patch" manquant.')
  if (!ended) throw new Error('Patch invalide : "*** End Patch" manquant.')
  if (!ops.length) throw new Error('Patch vide : aucun fichier.')
  return ops
}

const indexOfSeq = (file: string[], seq: string[], from: number): number => {
  for (let i = from; i <= file.length - seq.length; i++) {
    let ok = true
    for (let j = 0; j < seq.length; j++) {
      if (file[i + j] !== seq[j]) {
        ok = false
        break
      }
    }
    if (ok) return i
  }
  return -1
}

/** Applique des hunks à un contenu texte ; conserve les fins de ligne d'origine. */
export function applyHunks(original: string, hunks: PatchLine[][]): string {
  const crlf = /\r\n/.test(original)
  const lines = original.replace(/\r\n?/g, '\n').split('\n')
  let cursor = 0

  for (const hunk of hunks) {
    const oldSeq = hunk.filter((l) => l.sign !== '+').map((l) => l.text)
    const newSeq = hunk.filter((l) => l.sign !== '-').map((l) => l.text)
    if (!oldSeq.length) {
      lines.splice(cursor, 0, ...newSeq)
      cursor += newSeq.length
      continue
    }
    const at = indexOfSeq(lines, oldSeq, cursor)
    if (at === -1) {
      throw new Error(
        `Contexte du patch introuvable (ligne de contexte : « ${oldSeq[0].slice(0, 100)} »). ` +
          'Relis le fichier avec read_file et régénère le patch.'
      )
    }
    lines.splice(at, oldSeq.length, ...newSeq)
    cursor = at + newSeq.length
  }

  const out = lines.join('\n')
  return crlf ? out.replace(/\n/g, '\r\n') : out
}
