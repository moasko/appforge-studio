import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  File,
  FileCode2,
  FileJson,
  FileText,
  FileImage,
  FileCog,
  Database,
  Lock,
  Package,
  GitBranch,
  Palette
} from 'lucide-react'

/** Bouton icône avec info-bulle et raccourci */
export function IconButton({
  icon: Icon,
  label,
  shortcut,
  active,
  size = 16,
  className = '',
  ...rest
}: { icon: LucideIcon; label: string; shortcut?: string; active?: boolean; size?: number } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`icon-button${active ? ' active' : ''} ${className}`}
      aria-label={label}
      data-tip={shortcut ? `${label}  ${shortcut}` : label}
      {...rest}
    >
      <Icon size={size} strokeWidth={1.75} />
    </button>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>
}

export function Dot({ state }: { state: 'on' | 'off' | 'err' | 'busy' | null }) {
  return <span className={`status-dot ${state ?? 'off'}`} />
}

export function Spinner({ size = 12 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} />
}

/** Icône et couleur d'un fichier selon son extension */
export function fileIcon(name: string): { Icon: LucideIcon; color: string } {
  const n = name.toLowerCase()
  const ext = n.split('.').pop() ?? ''
  if (n === 'package.json' || n === 'package-lock.json') return { Icon: Package, color: '#e8574a' }
  if (n.startsWith('.env')) return { Icon: Lock, color: '#e5c07b' }
  if (n === '.gitignore') return { Icon: GitBranch, color: '#f05033' }
  if (n.endsWith('.config.ts') || n.endsWith('.config.js') || n === 'tsconfig.json' || n === 'eas.json' || n === 'app.json')
    return { Icon: FileCog, color: '#8fa1b3' }
  switch (ext) {
    case 'ts':
    case 'tsx':
      return { Icon: FileCode2, color: '#4f9dff' }
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return { Icon: FileCode2, color: '#f1d04b' }
    case 'json':
      return { Icon: FileJson, color: '#e5a54b' }
    case 'md':
      return { Icon: FileText, color: '#9aa3b5' }
    case 'css':
    case 'scss':
      return { Icon: Palette, color: '#c678dd' }
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'svg':
    case 'gif':
    case 'webp':
    case 'ico':
      return { Icon: FileImage, color: '#3ecf8e' }
    case 'db':
    case 'sqlite':
    case 'sql':
      return { Icon: Database, color: '#56b6c2' }
    default:
      return { Icon: File, color: '#7d8597' }
  }
}
