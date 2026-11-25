import { Filesystem, Directory } from '@capacitor/filesystem'
import { isNative, Native } from './native'
import { GITHUB_REPO } from './speech/engine.svelte'

export const APP_VERSION = __APP_VERSION__

export function newer(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false
  }
  return false
}

class Updater {
  state = $state<'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'error'>('idle')
  latest = $state<{ version: string; notes: string; url: string; sizeMB: number } | null>(null)
  progress = $state(0)
  message = $state('')

  async check(silent = false): Promise<boolean> {
    this.state = 'checking'
    this.message = ''
    try {
      const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json' },
        cache: 'no-store',
      })
      if (!r.ok) throw new Error('HTTP ' + r.status)
      const rel = await r.json()
      const apk = (rel.assets as { name: string; browser_download_url: string; size: number }[]).find((a) => a.name.endsWith('.apk'))
      const version = String(rel.tag_name).replace(/^v/, '')
      if (apk && newer(version, APP_VERSION)) {
        this.latest = { version, notes: rel.body ?? '', url: apk.browser_download_url, sizeMB: Math.round(apk.size / 1e5) / 10 }
        this.state = 'available'
        return true
      }
      this.state = 'latest'
      return false
    } catch (e) {
      this.state = silent ? 'idle' : 'error'
      this.message = 'לא הצלחתי לבדוק עדכונים. בדקו חיבור לאינטרנט.'
      return false
    }
  }

  async install() {
    if (!this.latest) return
    if (!isNative) {
      window.open(this.latest.url, '_blank')
      return
    }
    this.state = 'downloading'
    this.progress = 0
    const url = this.latest.url
    const handle = await Filesystem.addListener('progress', (p) => {
      if (p.contentLength > 0) this.progress = p.bytes / p.contentLength
    })
    try {
      const r = await Filesystem.downloadFile({ url, path: 'update.apk', directory: Directory.Cache, progress: true })
      const path = (r.path ?? (await Filesystem.getUri({ path: 'update.apk', directory: Directory.Cache })).uri).replace(/^file:\/\//, '')
      this.state = 'available'
      try {
        await Native.installApk({ path })
      } catch (e) {
        if ((e as { code?: string }).code === 'NO_PERMISSION') {
          this.message = 'יש לאשר לפתקול "התקנת אפליקציות לא מוכרות" ואז ללחוץ שוב על "התקנה".'
        } else throw e
      }
    } catch (e) {
      this.state = 'error'
      this.message = 'הורדת העדכון נכשלה.'
    } finally {
      handle.remove()
    }
  }
}

export const updater = new Updater()
