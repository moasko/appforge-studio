import type { GitStatus } from '@shared/types'
import { runCommand } from './shell'
import { parsePorcelain } from './gitStatus'

const quote = (p: string): string =>
  process.platform === 'win32' ? `"${p.replace(/"/g, '""')}"` : `'${p.replace(/'/g, `'\\''`)}'`

/** Liste les modifications du dépôt git du projet (ou signale l'absence de dépôt). */
export async function status(root: string): Promise<GitStatus> {
  const inside = await runCommand('git rev-parse --is-inside-work-tree', root, { timeoutMs: 5000 })
  if (inside.exitCode !== 0) return { repo: false, branch: null, changes: [] }

  const [branchR, st] = await Promise.all([
    runCommand('git rev-parse --abbrev-ref HEAD', root, { timeoutMs: 5000 }),
    runCommand('git status --porcelain', root, { timeoutMs: 8000 })
  ])

  return { repo: true, branch: branchR.exitCode === 0 ? branchR.output.trim() : null, changes: parsePorcelain(st.output) }
}

/** Restaure des fichiers suivis à leur version du dernier commit. */
export async function restore(root: string, paths: string[]): Promise<{ ok: boolean; error?: string }> {
  const list = paths.filter(Boolean)
  if (!list.length) return { ok: true }
  // --staged --worktree : annule aussi les changements déjà indexés
  const r = await runCommand(`git restore --staged --worktree -- ${list.map(quote).join(' ')}`, root, { timeoutMs: 20_000 })
  return r.exitCode === 0 ? { ok: true } : { ok: false, error: (r.output || `git restore a échoué (code ${r.exitCode})`).trim() }
}

/** Supprime des fichiers non suivis (git clean ciblé sur ces chemins). */
export async function cleanUntracked(root: string, paths: string[]): Promise<{ ok: boolean; error?: string }> {
  const list = paths.filter(Boolean)
  if (!list.length) return { ok: true }
  const r = await runCommand(`git clean -f -- ${list.map(quote).join(' ')}`, root, { timeoutMs: 20_000 })
  return r.exitCode === 0 ? { ok: true } : { ok: false, error: (r.output || `git clean a échoué (code ${r.exitCode})`).trim() }
}
