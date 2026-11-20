import { useEffect, useState } from 'react'

/** 0–59 s → « 42 s » ; < 1 h → « 12 min 04 s » ; sinon « 2 h 07 min ». */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  if (total < 60) return `${total} s`
  const m = Math.floor(total / 60)
  if (m < 60) return `${m} min ${String(total % 60).padStart(2, '0')} s`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}

/** Millisecondes écoulées depuis `startedAt`, rafraîchies chaque seconde. */
export function useElapsed(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!startedAt) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [startedAt])
  return startedAt ? Math.max(0, now - startedAt) : 0
}
