import { useEffect, useState } from 'react'
import {
  QrCode,
  Globe,
  Smartphone,
  Tablet,
  Monitor,
  RefreshCw,
  ExternalLink,
  Play,
  Wifi,
  X,
  Copy,
  Terminal,
  Square,
  ArrowRight
} from 'lucide-react'
import type { ProcessInfo } from '@shared/types'
import { actions, setState, useStore } from '../../store/appStore'
import { useProcesses } from '../../hooks/useProcesses'
import { IconButton, Dot, Spinner } from '../ui'

type Mode = 'device' | 'web'
type Viewport = 'phone' | 'tablet' | 'desktop'

const VIEWPORTS: { id: Viewport; icon: typeof Smartphone; label: string }[] = [
  { id: 'phone', icon: Smartphone, label: 'Téléphone' },
  { id: 'tablet', icon: Tablet, label: 'Tablette' },
  { id: 'desktop', icon: Monitor, label: 'Bureau' }
]

const isExpo = (p: ProcessInfo): boolean =>
  p.label === 'mobile' || p.label === 'web' || /\bexpo\b/.test(p.command)

const isLocalHttp = (u: string): boolean => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(u)

export function PreviewPanel() {
  const current = useStore((s) => s.current)
  const width = useStore((s) => s.sizes.preview)
  const procs = useProcesses(current?.id ?? '')
  const running = procs.filter((p) => p.status === 'running')
  const expoProcs = running.filter(isExpo)
  const expUrl = expoProcs.flatMap((p) => p.urls).find((u) => /^exps?:\/\//.test(u)) ?? null
  const httpUrls = expoProcs.flatMap((p) => p.urls).filter((u) => /^https?:\/\//.test(u))
  const webUrl = httpUrls.find(isLocalHttp) ?? httpUrls.find((u) => /^https?:\/\/[^/]+:\d+\/?$/.test(u)) ?? null
  const expoStarting = expoProcs.length > 0 && !expUrl

  const [qr, setQr] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('device')
  const [viewport, setViewport] = useState<Viewport>('phone')
  const [reload, setReload] = useState(0)
  const [addr, setAddr] = useState('')
  const [navUrl, setNavUrl] = useState<string | null>(null)
  const [frame, setFrame] = useState<'loading' | 'ready' | 'slow'>('loading')

  useEffect(() => {
    if (expUrl) window.api.util.qr(expUrl).then(setQr)
    else setQr(null)
  }, [expUrl])

  // Le QR reprend la main dès qu'Expo devient prêt (y compris si l'aperçu était fermé)
  useEffect(() => {
    const onReady = (): void => setMode('device')
    window.addEventListener('expo-ready', onReady)
    return () => window.removeEventListener('expo-ready', onReady)
  }, [])

  useEffect(() => {
    if (!webUrl) return
    setNavUrl(webUrl)
    setAddr(webUrl)
  }, [webUrl])

  useEffect(() => {
    if (!navUrl) return
    setFrame('loading')
    const t = setTimeout(() => setFrame((s) => (s === 'loading' ? 'slow' : s)), 12_000)
    return () => clearTimeout(t)
  }, [navUrl, reload])

  if (!current) return null

  const startExpo = (tunnel = false): void => {
    window.api.proc.start(current.id, 'mobile', tunnel ? 'npx expo start --tunnel' : 'npx expo start --lan', 'mobile')
    setState({ bottomOpen: true })
  }

  const copy = (text: string): void => {
    const done = (): void => actions.toast('Lien copié', 'success')
    const fail = (): void => actions.toast('Copie impossible', 'error')
    // file:// (app packagée) n'expose pas toujours l'API Clipboard
    if (navigator.clipboard?.writeText) return void navigator.clipboard.writeText(text).then(done, fail)
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      if (ok) done()
      else fail()
    } catch {
      fail()
    }
  }

  const go = (): void => {
    const url = addr.trim()
    if (!/^https?:\/\//.test(url)) return actions.toast('Adresse invalide — commencez par http://', 'error')
    setNavUrl(url)
    setReload((r) => r + 1)
  }

  return (
    <aside className="preview-panel" style={{ width }}>
      <div className="panel-header">
        <div className="segmented">
          <button className={mode === 'device' ? 'active' : ''} onClick={() => setMode('device')}>
            <Smartphone size={12} /> Appareil
          </button>
          <button className={mode === 'web' ? 'active' : ''} onClick={() => setMode('web')}>
            <Globe size={12} /> Web
          </button>
        </div>
        <div className="panel-actions">
          {mode === 'web' && navUrl && (
            <>
              <IconButton icon={RefreshCw} label="Recharger" size={13} onClick={() => setReload((r) => r + 1)} />
              <IconButton icon={ExternalLink} label="Ouvrir dans le navigateur" size={13} onClick={() => window.api.util.openExternal(navUrl)} />
            </>
          )}
          <IconButton icon={X} label="Fermer l'aperçu" shortcut="Ctrl P" size={14} onClick={() => setState({ previewOpen: false })} />
        </div>
      </div>

      {mode === 'web' && (
        <div className="preview-urlbar">
          <Globe size={12} />
          <input
            value={addr}
            placeholder="http://localhost:8081"
            spellCheck={false}
            onChange={(e) => setAddr(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') go()
            }}
          />
          <IconButton icon={Copy} label="Copier l'adresse" size={13} disabled={!addr.trim()} onClick={() => copy(addr.trim())} />
          <IconButton icon={ArrowRight} label="Ouvrir cette adresse" size={13} disabled={!addr.trim()} onClick={go} />
        </div>
      )}

      <div className={`preview-body${mode === 'web' ? ' web' : ''}`}>
        {mode === 'device' ? (
          <div className="device">
            <div className="device-notch" />
            <div className="device-screen">
              {qr && expUrl ? (
                <div className="device-qr">
                  <div className="qr-status">
                    <Dot state="on" /> Serveur Expo actif
                  </div>
                  <button className="qr-frame" onClick={() => copy(expUrl)} data-tip="Copier le lien Expo">
                    <img src={qr} alt="QR Expo Go" />
                  </button>
                  <div className="qr-title">Scannez avec Expo Go</div>
                  <div className="qr-url" onClick={() => copy(expUrl)} data-tip="Copier">
                    {expUrl}
                  </div>
                  <div className="qr-hint">
                    <Wifi size={11} /> Même réseau Wi-Fi que ce PC
                  </div>
                  <div className="qr-actions">
                    <button className="btn sm" onClick={() => copy(expUrl)}>
                      <Copy size={12} /> Copier le lien
                    </button>
                    <button className="btn sm ghost" onClick={() => setState({ bottomOpen: true })}>
                      <Terminal size={12} /> Logs
                    </button>
                  </div>
                </div>
              ) : expoStarting ? (
                <div className="device-empty">
                  <Spinner size={22} />
                  <div>Démarrage d’Expo…</div>
                  <p>Le QR code apparaîtra dès que le serveur est prêt.</p>
                  <button className="btn sm ghost" onClick={() => setState({ bottomOpen: true })}>
                    <Terminal size={12} /> Voir les logs
                  </button>
                </div>
              ) : (
                <div className="device-empty">
                  <QrCode size={28} />
                  <div>Expo n’est pas lancé</div>
                  <p>Démarrez le serveur puis scannez le QR code avec Expo Go.</p>
                  <button className="btn primary sm" onClick={() => startExpo()}>
                    <Play size={12} /> Démarrer Expo
                  </button>
                  <button className="btn ghost sm" onClick={() => startExpo(true)}>
                    Hors du réseau local (tunnel)
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="web-stage">
            <div className="web-viewports">
              <div className="segmented sm">
                {VIEWPORTS.map((v) => (
                  <button key={v.id} className={viewport === v.id ? 'active' : ''} onClick={() => setViewport(v.id)} data-tip={v.label}>
                    <v.icon size={12} /> {v.label}
                  </button>
                ))}
              </div>
            </div>
            {navUrl ? (
              <div className={`web-frame ${viewport}`}>
                <iframe
                  key={`${navUrl}-${reload}`}
                  src={navUrl}
                  title="Aperçu web"
                  onLoad={() => setFrame('ready')}
                />
                {frame === 'loading' && (
                  <div className="web-overlay">
                    <Spinner size={20} />
                    <span>Chargement de l’aperçu…</span>
                  </div>
                )}
                {frame === 'slow' && (
                  <div className="web-overlay">
                    <span>La page ne répond pas encore.</span>
                    <button className="btn sm" onClick={() => window.api.util.openExternal(navUrl)}>
                      <ExternalLink size={12} /> Ouvrir dans le navigateur
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="web-empty">
                {expoStarting ? (
                  <>
                    <Spinner size={22} />
                    <div>Expo démarre…</div>
                    <p>Le bundler web sera disponible sur cette page dès qu’il sera prêt.</p>
                  </>
                ) : (
                  <>
                    <Globe size={28} />
                    <div>Aperçu web indisponible</div>
                    <p>Lancez Expo pour voir la version web de l’app (react-native-web requis).</p>
                    <button className="btn primary sm" onClick={() => startExpo()}>
                      <Play size={12} /> Démarrer Expo
                    </button>
                  </>
                )}
              </div>
            )}
            {navUrl && <div className="web-caption">Rechargement à chaud — les modifications du code apparaissent ici.</div>}
          </div>
        )}

        {running.length > 0 && (
          <div className="svc-chips">
            {running.map((p) => {
              const url = p.urls.find((u) => u.startsWith('http')) ?? p.urls[0]
              return (
                <div key={p.id} className="svc-chip">
                  <Dot state="on" />
                  <button className="svc-chip-main" onClick={() => (url ? window.api.util.openExternal(url) : setState({ sideView: 'processes' }))}>
                    <span className="svc-chip-name">{p.label}</span>
                    <span className="svc-chip-url">{url ?? 'démarrage…'}</span>
                  </button>
                  {url && (
                    <button className="svc-chip-action" data-tip="Copier le lien" onClick={() => copy(url)}>
                      <Copy size={11} />
                    </button>
                  )}
                  <button className="svc-chip-action stop" data-tip={`Arrêter ${p.label}`} onClick={() => window.api.proc.stop(p.id)}>
                    <Square size={10} fill="currentColor" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}
