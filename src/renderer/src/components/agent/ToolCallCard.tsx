import { Fragment, useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ListTodo, Boxes, FolderTree, FileText, Search, FilePlus2, FilePen, FileDiff, Trash2, TerminalSquare, Play, ScrollText, Square, Cpu, Globe,
  Brain, Check, X, Loader2, ShieldQuestion, Ban, ChevronRight, Wrench
} from 'lucide-react'
import type { ToolCallView } from '@shared/types'
import { actions } from '../../store/appStore'
import { diffHunks, diffRows, hunkHeader } from '../../lib/diff'

const META: Record<string, { icon: LucideIcon; verb: string }> = {
  update_plan: { icon: ListTodo, verb: 'Plan' },
  scaffold_project: { icon: Boxes, verb: 'Génère le projet' },
  list_files: { icon: FolderTree, verb: 'Explore' },
  read_file: { icon: FileText, verb: 'Lit' },
  search: { icon: Search, verb: 'Recherche' },
  write_file: { icon: FilePlus2, verb: 'Écrit' },
  edit_file: { icon: FilePen, verb: 'Modifie' },
  apply_patch: { icon: FileDiff, verb: 'Patch' },
  memory_save: { icon: Brain, verb: 'Mémorise' },
  memory_search: { icon: Brain, verb: 'Consulte la mémoire' },
  memory_delete: { icon: Trash2, verb: 'Oublie' },
  delete_path: { icon: Trash2, verb: 'Supprime' },
  run_command: { icon: TerminalSquare, verb: 'Exécute' },
  start_process: { icon: Play, verb: 'Démarre' },
  process_logs: { icon: ScrollText, verb: 'Logs' },
  stop_process: { icon: Square, verb: 'Arrête' },
  list_processes: { icon: Cpu, verb: 'Services' },
  http_request: { icon: Globe, verb: 'Requête' }
}

const s = (v: unknown): string => (typeof v === 'string' ? v : '')

function target(c: ToolCallView): string {
  const i = c.input as Record<string, unknown>
  switch (c.name) {
    case 'run_command':
    case 'start_process':
      return (i.cwd ? `${s(i.cwd)} › ` : '') + s(i.command)
    case 'http_request':
      return `${s(i.method) || 'GET'} ${s(i.url)}`
    case 'scaffold_project':
      return s(i.app_name)
    case 'search':
      return `/${s(i.pattern)}/`
    case 'update_plan':
      return `${(i.items as unknown[] | undefined)?.length ?? 0} étapes`
    case 'list_files':
      return s(i.path) || '.'
    case 'apply_patch': {
      const files = patchFiles(s(i.patch))
      return files.length > 1 ? `${files.length} fichiers (${files[0]}…)` : files[0] || 'patch'
    }
    case 'memory_save':
    case 'memory_search':
      return s(i.text) || s(i.query) || s(i.id)
    default:
      return s(i.path) || s(i.label)
  }
}

const patchFiles = (patch: string): string[] => [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((m) => m[1].trim())

function patchStats(patch: string): { add: number; del: number } {
  let add = 0
  let del = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) add++
    else if (line.startsWith('-') && !line.startsWith('---')) del++
  }
  return { add, del }
}

function StatusIcon({ status }: { status: ToolCallView['status'] }) {
  switch (status) {
    case 'running':
    case 'pending':
      return <Loader2 size={13} className="spin st-run" />
    case 'done':
      return <Check size={13} className="st-ok" />
    case 'error':
      return <X size={13} className="st-err" />
    case 'denied':
      return <Ban size={13} className="st-err" />
    case 'awaiting-approval':
      return <ShieldQuestion size={13} className="st-warn" />
  }
}

/** Diff unifié : numéros de ligne, contextes repliés, signes − / +. */
function Diff({ oldText, newText }: { oldText: string; newText: string }) {
  const hunks = useMemo(() => diffHunks(diffRows(oldText, newText)), [oldText, newText])
  return (
    <div className="diff">
      {hunks.map((hunk, hi) => (
        <Fragment key={hi}>
          <div className="hunk">{hunkHeader(hunk)}</div>
          {hunk.map((r, i) => (
            <div key={i} className={r.kind}>
              <span className="ln">{r.oldNo ?? ''}</span>
              <span className="ln">{r.newNo ?? ''}</span>
              <span className="sign">{r.kind === 'del' ? '−' : r.kind === 'add' ? '+' : ' '}</span>
              <span className="code">{r.text || ' '}</span>
            </div>
          ))}
        </Fragment>
      ))}
      {!hunks.length && <div className="hunk">Aucune différence.</div>}
    </div>
  )
}

export function ToolCallCard({ call, onApprove }: { call: ToolCallView; onApprove: (ok: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const meta = META[call.name] ?? { icon: Wrench, verb: call.name }
  const Icon = meta.icon
  const input = call.input as Record<string, unknown>
  const isFile = ['read_file', 'write_file', 'edit_file'].includes(call.name) && s(input.path)
  const lines = call.name === 'write_file' ? s(input.content).split('\n').length : 0

  return (
    <div className={`tl-item ${call.status}${open ? ' open' : ''}`}>
      <div className="tl-node">
        <Icon size={12} />
      </div>
      <div className="tl-main">
        <div className="tl-head" onClick={() => setOpen(!open)}>
          <ChevronRight size={12} className="tl-chev" />
          <span className="tl-verb">{meta.verb}</span>
          <span
            className={`tl-target${isFile ? ' link' : ''}`}
            onClick={(e) => {
              if (!isFile) return
              e.stopPropagation()
              actions.openFile(s(input.path))
            }}
          >
            {target(call)}
          </span>
          {call.name === 'write_file' && <span className="tl-stat add">+{lines}</span>}
          {call.name === 'edit_file' && (
            <span className="tl-stat">
              <span className="add">+{s(input.new_string).split('\n').length}</span> <span className="del">−{s(input.old_string).split('\n').length}</span>
            </span>
          )}
          {call.name === 'apply_patch' && (
            <span className="tl-stat">
              <span className="add">+{patchStats(s(input.patch)).add}</span> <span className="del">−{patchStats(s(input.patch)).del}</span>
            </span>
          )}
          <StatusIcon status={call.status} />
        </div>

        {call.status === 'awaiting-approval' && (
          <div className="tl-approval">
            <div className="tl-approval-title">
              <ShieldQuestion size={14} /> Autoriser cette action ?
            </div>
            <pre>{call.name === 'run_command' || call.name === 'start_process' ? s(input.command) : JSON.stringify(call.input, null, 2).slice(0, 2000)}</pre>
            <div className="tl-approval-actions">
              <button className="btn primary sm" onClick={() => onApprove(true)}>
                <Check size={13} /> Autoriser
              </button>
              <button className="btn ghost sm" onClick={() => onApprove(false)}>
                Refuser
              </button>
            </div>
          </div>
        )}

        {open && call.status !== 'awaiting-approval' && (
          <div className="tl-body">
            {call.name === 'edit_file' && <Diff oldText={s(input.old_string)} newText={s(input.new_string)} />}
            {call.name === 'write_file' && <pre className="tl-code">{s(input.content).slice(0, 8000)}</pre>}
            {call.name === 'apply_patch' && <pre className="tl-code">{s(input.patch).slice(0, 12_000)}</pre>}
            {(call.name === 'memory_save' || call.name === 'memory_search' || call.name === 'memory_delete') && (
              <pre className="tl-code">{JSON.stringify(call.input, null, 2)}</pre>
            )}
            {call.output && call.name !== 'write_file' && call.name !== 'edit_file' && <pre className="tl-out">{call.output}</pre>}
            {call.output && (call.name === 'write_file' || call.name === 'edit_file') && call.status === 'error' && <pre className="tl-out">{call.output}</pre>}
          </div>
        )}
        {!open && call.status === 'running' && call.output && <pre className="tl-live">{call.output.slice(-500)}</pre>}
        {!open && call.status === 'error' && call.output && <div className="tl-error">{call.output.slice(0, 220)}</div>}
      </div>
    </div>
  )
}
