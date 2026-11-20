import { useEffect, useState } from 'react'
import type { ProcessInfo } from '@shared/types'

/** Liste des processus du projet, mise à jour en temps réel. */
export function useProcesses(projectId: string): ProcessInfo[] {
  const [list, setList] = useState<ProcessInfo[]>([])
  useEffect(() => {
    if (!projectId) {
      setList([])
      return
    }
    let alive = true
    window.api.proc.list(projectId).then((l) => alive && setList(l))
    const off = window.api.proc.onEvent((e) => {
      if (e.type !== 'status' || e.info.projectId !== projectId) return
      setList((prev) => {
        const i = prev.findIndex((p) => p.id === e.info.id)
        if (i === -1) return [...prev, e.info]
        const next = [...prev]
        next[i] = e.info
        return next
      })
    })
    return () => {
      alive = false
      off()
    }
  }, [projectId])
  return list
}
