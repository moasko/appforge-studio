import type { GitChange } from '@shared/types'

/** Parse la sortie de `git status --porcelain` (renommages et chemins entre guillemets compris). */
export function parsePorcelain(output: string): GitChange[] {
  const changes: GitChange[] = []
  for (const line of output.split('\n')) {
    if (!line.trim()) continue
    const status = line.slice(0, 2).trim() || '?'
    let p = line.slice(3).trim()
    if (p.includes(' -> ')) p = p.split(' -> ').pop() ?? p
    p = p.replace(/^"|"$/g, '')
    changes.push({ path: p, status, tracked: status !== '??' })
  }
  return changes
}
