import { useRef } from 'react'

/**
 * Poignée de redimensionnement. `direction` = axe du déplacement.
 * `invert` pour les panneaux ancrés à droite / en bas (la taille augmente quand on tire vers la gauche / le haut).
 */
export function Splitter({
  direction,
  value,
  min,
  max,
  invert,
  onChange
}: {
  direction: 'x' | 'y'
  value: number
  min: number
  max: number
  invert?: boolean
  onChange: (v: number) => void
}) {
  const start = useRef<{ pos: number; value: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent): void => {
    start.current = { pos: direction === 'x' ? e.clientX : e.clientY, value }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    document.body.classList.add(direction === 'x' ? 'resizing-x' : 'resizing-y')
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    if (!start.current) return
    const delta = (direction === 'x' ? e.clientX : e.clientY) - start.current.pos
    const next = start.current.value + (invert ? -delta : delta)
    onChange(Math.round(Math.min(max, Math.max(min, next))))
  }
  const onPointerUp = (): void => {
    start.current = null
    document.body.classList.remove('resizing-x', 'resizing-y')
  }

  return (
    <div
      className={`splitter splitter-${direction}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={() => onChange(direction === 'x' ? 280 : 220)}
    />
  )
}
