import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { isNative, Native, float32ToB64 } from '../native'
import { settings, type EngineId } from '../settings.svelte'
import { Recorder } from './recorder'
import OzenWorker from './ozen.worker.ts?worker'

export const GITHUB_REPO = 'tzviki1304/petkol'
const MIRROR = `https://github.com/${GITHUB_REPO}/releases/download/models-v1/`

export interface ModelDef {
  id: EngineId
  name: string
  short: string
  description: string
  sizeMB: number
  minRamMB: number
  files: { path: string; urls: string[]; bytes?: number }[]
}

// On Android the model is the "light" int8 build (80 MB instead of 243 MB, same transcripts in our tests,
// faster): made with onnxruntime quantize_dynamic and hosted in this repo's models-v1 release.
// The browser build uses the official fp16 encoder from Hugging Face through WASM.
const OZEN_ENCODER: 'fp16' | 'fp32' | 'int8' = isNative ? 'int8' : 'fp16'
const HF_OZEN = 'https://huggingface.co/itayinbar/Ozen-v1/resolve/main/'
const OZEN_JSON = ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json']
const OZEN_INT8 = ['onnx/encoder_model_int8.onnx', 'onnx/decoder_model_merged_int8.onnx']
const OZEN_FP32 = ['onnx/encoder_model.onnx', 'onnx/decoder_model_merged.onnx']
const ozenFile = (f: string) => ({
  path: `ozen-v1/${f}`,
  urls: f.includes('_int8') ? [MIRROR + 'ozen-v1__' + f.replace('/', '__')] : [HF_OZEN + f, MIRROR + 'ozen-v1__' + f.replace('/', '__')],
})
const ozenFiles = isNative ? [...OZEN_JSON, ...OZEN_INT8] : [...OZEN_JSON, 'onnx/encoder_model_fp16.onnx', 'onnx/decoder_model_merged.onnx']
const VARIANT_KEY = 'petkol.ozenVariant'
const LOWMEM_KEY = 'petkol.autoLowMem'

export const MODELS: ModelDef[] = [
  {
    id: 'ozen',
    name: 'אוזן: מודל רגיל',
    short: 'רגיל',
    description: 'מהיר וקל, מתאים לכל מכשיר, גם עם 2GB זיכרון. עברית בלבד, דיוק טוב מאוד לדיבור רגיל.',
    sizeMB: isNative ? 82 : 165,
    minRamMB: 1500,
    files: ozenFiles.map(ozenFile),
  },
  {
    id: 'ivrit',
    name: 'עברית.AI: מודל מדויק',
    short: 'מדויק',
    description: 'המודל העמוק של ivrit.ai. מדויק יותר, בעיקר במילים נדירות, שמות ומונחים מקצועיים, אבל כבד ואיטי: במכשיר חלש כל משפט יכול לקחת כמה דקות. מתאים לטלפון חזק (3GB זיכרון ומעלה), או כשאין מניעה לחכות.',
    sizeMB: 547,
    minRamMB: 2800,
    files: [{ path: 'ivrit/ggml-ivrit-turbo-q5_0.bin', urls: [MIRROR + 'ggml-ivrit-turbo-q5_0.bin'] }],
  },
]

const TRY_KEY = 'petkol.nativeTry'
const BROKEN_KEY = 'petkol.nativeBroken'

export type ModelStatus = 'missing' | 'downloading' | 'downloaded' | 'loading' | 'ready' | 'error'

class SpeechEngine {
  status = $state<Record<EngineId, ModelStatus>>({ ozen: 'missing', ivrit: 'missing' })
  progress = $state<Record<EngineId, number>>({ ozen: 0, ivrit: 0 })
  error = $state<string>('')
  ramMB = $state(0)
  /** Set when the fast native engine crashed the app; we then use the slower, safe engine. */
  nativeBroken = $state(false)
  notice = $state('')
  /** The old heavy model (243 MB) is installed; the light one is recommended. */
  upgradeAvailable = $state(false)
  /** Turned on automatically after the system closed the app for lack of memory. */
  autoLowMem = $state(false)
  lastExit = $state<{ reason: string; description?: string; timestamp?: number } | null>(null)
  availMB = $state(0)
  modelFiles = $state('')

  private worker: Worker | null = null
  private workerReady: Promise<void> | null = null
  private nextId = 1
  private pending = new Map<number, (r: unknown) => void>()
  private nativeLoaded: EngineId | null = null
  private ozenNative = false
  private cancelDownload = false

  async init() {
    const done = JSON.parse(localStorage.getItem('petkol.models') ?? '{}') as Partial<Record<EngineId, boolean>>
    for (const m of MODELS) if (done[m.id]) this.status[m.id] = 'downloaded'
    if (!isNative) this.status.ozen = 'downloaded' // the browser build streams it from Hugging Face and caches it
    if (isNative) {
      try {
        const info = await Native.deviceInfo()
        this.ramMB = info.totalRamMB
        this.availMB = info.availRamMB
      } catch {}
      if (this.status.ozen !== 'missing' && localStorage.getItem(VARIANT_KEY) !== 'int8') this.upgradeAvailable = true
      this.autoLowMem = localStorage.getItem(LOWMEM_KEY) === '1'
      // Why did the app close last time? (Android 11+ keeps the reason.)
      let exit: { reason: string; description?: string; timestamp?: number; isNew?: boolean } | null = null
      try {
        exit = await Native.lastExit()
        if (exit?.isNew) {
          this.lastExit = exit
          // the speech process (":asr") was closed for memory while the app stayed alive: keep it lighter from now on
          const p = (exit as { processName?: string }).processName ?? ''
          if (p.endsWith(':asr') && ['low_memory', 'signaled', 'excessive_resource_usage'].includes(exit.reason)) {
            localStorage.setItem(LOWMEM_KEY, '1')
          }
        }
      } catch {}
      // A crash inside native code kills the whole app, so we leave a marker before each native call.
      // If the marker survived, the previous run died there.
      if (localStorage.getItem(TRY_KEY)) {
        localStorage.removeItem(TRY_KEY)
        const memory = !exit || !exit.isNew || ['low_memory', 'signaled', 'excessive_resource_usage', 'freezer', 'unknown', 'other'].includes(exit.reason)
        if (memory) {
          // Killed for memory: the fast engine is fine, it just needs to take less room.
          localStorage.setItem(LOWMEM_KEY, '1')
          this.autoLowMem = true
          this.notice = 'בפעם הקודמת המכשיר סגר את פתקול כי נגמר הזיכרון. הפעלנו "חיסכון בזיכרון": התמלול יהיה קצת איטי יותר, אבל יציב.'
        } else {
          localStorage.setItem(BROKEN_KEY, '1')
          this.notice = 'המנוע המהיר נכשל במכשיר הזה, ולכן עברנו למנוע הבטוח. הוא איטי יותר, אבל יציב.'
        }
      }
      this.nativeBroken = localStorage.getItem(BROKEN_KEY) === '1'
      if (this.upgradeAvailable && !this.notice && this.ramMB && this.ramMB <= 3200) {
        this.notice = 'יש גרסה קלה ומהירה יותר של מודל הדיבור (80MB). מומלץ להוריד אותה בהגדרות ← הכתבה.'
      }
    }
  }

  /** Low-memory mode: one model part in memory at a time, fewer threads, shorter recording pieces. */
  lowMem(): boolean {
    if (settings.lowMem === 'on') return true
    if (settings.lowMem === 'off') return false
    return this.autoLowMem || (!!this.ramMB && this.ramMB <= 3200)
  }

  /** Recording piece length for long recordings. */
  chunkSec(): number {
    if (settings.chunkSec > 0) return settings.chunkSec
    return this.lowMem() ? 15 : 28
  }

  /** Downloads the light model over an old heavy one, then deletes the heavy files. */
  async upgradeOzen() {
    if (!isNative) return
    this.status.ozen = 'downloading'
    this.progress.ozen = 0
    this.error = ''
    if (this.ozenNative) {
      await Native.ozenUnload().catch(() => {})
      this.ozenNative = false
    }
    this.disposeWorker()
    try {
      await this.fetchFiles('ozen', [...OZEN_JSON, ...OZEN_INT8].map(ozenFile), 82)
      for (const f of OZEN_FP32) await Filesystem.deleteFile({ path: `models/ozen-v1/${f}`, directory: Directory.Data }).catch(() => {})
      localStorage.setItem(VARIANT_KEY, 'int8')
      this.upgradeAvailable = false
      this.status.ozen = 'downloaded'
    } catch (e) {
      this.status.ozen = 'downloaded' // the old model still works
      this.error = 'ההורדה נכשלה. בדקו חיבור לאינטרנט ונסו שוב.'
    }
  }

  /** Text for "מידע לתמיכה" in settings. */
  async diagnostics(): Promise<string> {
    const lines = [`פתקול ${__APP_VERSION__}`]
    if (isNative) {
      try {
        const d = await Native.deviceInfo()
        lines.push(`מכשיר: ${d.manufacturer} ${d.model}, Android SDK ${d.sdk}, ${d.cores} ליבות`)
        lines.push(`זיכרון: ${d.totalRamMB}MB, פנוי עכשיו ${d.availRamMB}MB`)
      } catch {}
    }
    lines.push(`מודל: ${settings.engine === 'ivrit' ? 'מדויק' : 'רגיל'} (${localStorage.getItem(VARIANT_KEY) === 'int8' ? 'קל' : isNative ? 'כבד' : 'דפדפן'})${this.modelFiles ? ' · ' + this.modelFiles : ''}`)
    lines.push(`מנוע: ${this.useNativeOzen() ? 'מהיר' : 'בטוח'}${this.nativeBroken ? ' (המהיר סומן כתקול)' : ''}`)
    lines.push(`חיסכון בזיכרון: ${this.lowMem() ? 'פועל' : 'כבוי'}${this.autoLowMem ? ' (הופעל אוטומטית)' : ''}, ${this.threads()} מעבדים, קטעים של ${this.chunkSec()} שניות`)
    if (this.lastExit) lines.push(`סגירה אחרונה: ${this.lastExit.reason}${this.lastExit.description ? ' · ' + this.lastExit.description : ''}`)
    return lines.join('\n')
  }

  /** Threads for the model: fewer on small devices so the CPU and memory are not overwhelmed. */
  threads(): number {
    const cores = navigator.hardwareConcurrency || 4
    if (settings.calm || this.lowMem()) return Math.min(2, cores)
    return Math.min(4, cores)
  }

  /** Whether Ozen runs natively (fast) or inside the app's own WASM runtime (slow, but safe everywhere). */
  useNativeOzen(): boolean {
    if (!isNative) return false
    if (settings.processing === 'safe') return false
    if (settings.processing === 'fast') return true
    return !this.nativeBroken
  }

  resetNativeBroken() {
    localStorage.removeItem(BROKEN_KEY)
    this.nativeBroken = false
    this.notice = ''
  }

  private async guarded<T>(fn: () => Promise<T>): Promise<T> {
    localStorage.setItem(TRY_KEY, String(Date.now()))
    try {
      return await fn()
    } finally {
      localStorage.removeItem(TRY_KEY)
    }
  }

  model(id: EngineId) {
    return MODELS.find((m) => m.id === id)!
  }

  available(id: EngineId) {
    return id === 'ozen' || isNative
  }

  private markDone(id: EngineId, v: boolean) {
    const done = JSON.parse(localStorage.getItem('petkol.models') ?? '{}')
    done[id] = v
    localStorage.setItem('petkol.models', JSON.stringify(done))
  }

  async download(id: EngineId) {
    if (!isNative) return
    const m = this.model(id)
    this.status[id] = 'downloading'
    this.progress[id] = 0
    this.error = ''
    try {
      await this.fetchFiles(id, m.files, m.sizeMB)
      this.status[id] = 'downloaded'
      this.markDone(id, true)
      if (id === 'ozen') {
        localStorage.setItem(VARIANT_KEY, 'int8')
        this.upgradeAvailable = false
      }
    } catch (e) {
      this.status[id] = 'error'
      this.error = 'ההורדה נכשלה. בדקו חיבור לאינטרנט ונסו שוב.'
      console.error(e)
    }
  }

  private async fetchFiles(id: EngineId, files: ModelDef['files'], sizeMB: number) {
    this.cancelDownload = false
    const total = sizeMB * 1024 * 1024
    let doneBytes = 0
    for (const f of files) {
      const dir = `models/${f.path.split('/').slice(0, -1).join('/')}`
      await Filesystem.mkdir({ path: dir, directory: Directory.Data, recursive: true }).catch(() => {})
      let ok = false
      let lastErr: unknown = null
      for (const url of f.urls) {
        if (this.cancelDownload) throw new Error('בוטל')
        const handle = await Filesystem.addListener('progress', (p) => {
          if (p.url !== url) return
          this.progress[id] = Math.min(0.999, (doneBytes + p.bytes) / total)
        })
        try {
          await Filesystem.downloadFile({ url, path: `models/${f.path}`, directory: Directory.Data, recursive: true, progress: true })
          const st = await Filesystem.stat({ path: `models/${f.path}`, directory: Directory.Data })
          if (st.size < 50) throw new Error('empty file')
          doneBytes += st.size
          ok = true
        } catch (e) {
          lastErr = e
        } finally {
          await handle.remove()
        }
        if (ok) break
      }
      if (!ok) throw lastErr ?? new Error('download failed')
    }
    this.progress[id] = 1
  }

  cancel() {
    this.cancelDownload = true
  }

  async remove(id: EngineId) {
    if (id === 'ivrit' && this.nativeLoaded === 'ivrit') await Native.whisperUnload().catch(() => {})
    if (id === 'ozen') {
      this.disposeWorker()
      if (this.ozenNative) await Native.ozenUnload().catch(() => {})
      this.ozenNative = false
    }
    if (isNative) {
      const dir = this.model(id).files[0].path.split('/')[0]
      await Filesystem.rmdir({ path: `models/${dir}`, directory: Directory.Data, recursive: true }).catch(() => {})
    }
    this.markDone(id, false)
    if (id === 'ozen') {
      localStorage.removeItem(VARIANT_KEY)
      this.upgradeAvailable = false
    }
    this.status[id] = isNative ? 'missing' : 'downloaded'
    if (settings.engine === id) settings.engine = 'ozen'
  }

  private disposeWorker() {
    this.worker?.terminate()
    this.worker = null
    this.workerReady = null
    this.workerMode = null
    if (this.status.ozen === 'ready') this.status.ozen = 'downloaded'
  }

  /** Makes sure the chosen engine is loaded in memory. */
  async prepare(id: EngineId): Promise<void> {
    if (this.status[id] === 'ready') return
    if (this.status[id] === 'missing' || this.status[id] === 'downloading') throw new Error('המודל עוד לא הורד')
    if (id === 'ozen') {
      if (this.nativeLoaded) {
        await Native.whisperUnload().catch(() => {})
        this.nativeLoaded = null
        this.status.ivrit = 'downloaded'
      }
      const native = this.useNativeOzen()
      if (this.workerMode !== null && this.workerMode !== native) this.disposeWorker()
      if (!native && this.ozenNative) {
        await Native.ozenUnload().catch(() => {})
        this.ozenNative = false
      }
      await this.startWorker(native)
      if (native && !this.ozenNative) {
        this.status.ozen = 'loading'
        const uri = await Filesystem.getUri({ path: 'models/ozen-v1', directory: Directory.Data })
        try {
          const r = await this.guarded(() => Native.ozenLoad({ dir: uri.uri.replace(/^file:\/\//, ''), threads: this.threads(), lowMem: true, staged: this.lowMem() }))
          if (!r.ok) throw new Error('load failed')
          this.modelFiles = [r.encoder, r.decoder].filter(Boolean).join(' + ')
          this.ozenNative = true
          this.status.ozen = 'ready'
        } catch (e) {
          this.status.ozen = 'downloaded'
          throw new Error('טעינת המודל נכשלה. נסו למחוק ולהוריד אותו מחדש.')
        }
      } else if (!native) {
        this.status.ozen = 'ready'
      }
    } else {
      if (this.ozenNative) {
        await Native.ozenUnload().catch(() => {})
        this.ozenNative = false
      }
      this.disposeWorker()
      this.status.ivrit = 'loading'
      const uri = await Filesystem.getUri({ path: `models/${this.model('ivrit').files[0].path}`, directory: Directory.Data })
      const path = uri.uri.replace(/^file:\/\//, '')
      try {
        const info = await Native.deviceInfo().catch(() => null)
        if (info && info.availRamMB < 900) throw new Error('low memory')
        const r = await this.guarded(() => Native.whisperLoad({ path, threads: this.threads() }))
        if (!r.ok) throw new Error('load failed')
        this.nativeLoaded = 'ivrit'
        this.status.ivrit = 'ready'
      } catch (e) {
        this.status.ivrit = 'downloaded'
        throw new Error('טעינת המודל המדויק נכשלה, כנראה אין מספיק זיכרון. נסו את המודל הרגיל.')
      }
    }
  }

  private workerMode: boolean | null = null

  private async startWorker(native: boolean) {
    if (this.workerReady) return this.workerReady
    this.workerMode = native
    this.status.ozen = 'loading'
    this.workerReady = new Promise<void>(async (resolve, reject) => {
      const w = new OzenWorker()
      this.worker = w
      let localBase: string | null = null
      if (isNative) {
        const uri = await Filesystem.getUri({ path: 'models', directory: Directory.Data })
        localBase = Capacitor.convertFileSrc(uri.uri) + '/'
      }
      w.onmessage = (e) => {
        const m = e.data
        if (m.type === 'loaded') {
          resolve()
        } else if (m.type === 'progress') {
          if (!isNative && typeof m.progress === 'number') this.progress.ozen = m.progress / 100
        } else if (m.type === 'error') {
          this.status.ozen = isNative ? 'downloaded' : 'error'
          this.error = 'טעינת המודל נכשלה: ' + m.error
          this.workerReady = null
          reject(new Error(this.error))
        } else if (m.type === 'result' || m.type === 'features' || m.type === 'decoded') {
          this.pending.get(m.id)?.(m)
          this.pending.delete(m.id)
        }
      }
      w.postMessage({
        type: 'load',
        localBase,
        modelId: isNative ? 'ozen-v1' : 'itayinbar/Ozen-v1',
        encoder: isNative ? (localStorage.getItem(VARIANT_KEY) === 'int8' ? 'int8' : 'fp32') : OZEN_ENCODER,
        decoder: isNative && localStorage.getItem(VARIANT_KEY) === 'int8' ? 'int8' : 'fp32',
        textOnly: native,
        threads: this.threads(),
      })
    })
    return this.workerReady
  }

  async transcribe(audio: Float32Array): Promise<{ text: string; ms: number }> {
    const id = settings.engine
    await this.prepare(id)
    if (id === 'ivrit') {
      const r = await this.guarded(() => Native.whisperTranscribe({ audio: float32ToB64(audio), language: 'he', prompt: settings.vocabulary || undefined }))
      return { text: r.text.trim(), ms: r.ms }
    }
    if (this.ozenNative) {
      const t0 = performance.now()
      const f = await this.ask<{ features: Float32Array }>({ type: 'features', audio }, [audio.buffer])
      const b64 = float32ToB64(f.features)
      let r: { tokens: number[] }
      try {
        r = await this.guarded(() => Native.ozenRun({ features: b64, maxTokens: 220 }))
      } catch (e) {
        const code = (e as { code?: string }).code
        if (code !== 'ASR_DIED' && code !== 'NOT_LOADED') throw e
        // The model runs in its own process; the system closed it for memory. The app is fine:
        // switch to low-memory mode, load again one part at a time, and retry this piece once.
        localStorage.setItem(LOWMEM_KEY, '1')
        this.autoLowMem = true
        this.ozenNative = false
        this.status.ozen = 'downloaded'
        await this.prepare('ozen')
        r = await this.guarded(() => Native.ozenRun({ features: b64, maxTokens: 220 }))
      }
      const d = await this.ask<{ text: string }>({ type: 'decode', tokens: r.tokens })
      return { text: d.text, ms: Math.round(performance.now() - t0) }
    }
    const r = await this.ask<{ text: string; ms: number }>({ type: 'transcribe', audio }, [audio.buffer])
    return { text: r.text, ms: r.ms }
  }

  private ask<T>(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
    return new Promise((resolve, reject) => {
      const rid = this.nextId++
      this.pending.set(rid, (r) => ((r as { error?: string }).error ? reject(new Error((r as { error?: string }).error)) : resolve(r as T)))
      this.worker!.postMessage({ ...msg, id: rid }, transfer)
    })
  }
}

export const engine = new SpeechEngine()
;(globalThis as Record<string, unknown>).__petkol = { engine }

// ---------------- text clean-up ----------------

const COMMANDS: [RegExp, string][] = [
  [/\s*פסקה חדשה\s*/g, '\n\n'],
  [/\s*שורה חדשה\s*/g, '\n'],
  [/\s*סימן שאלה\b/g, '?'],
  [/\s*סימן קריאה\b/g, '!'],
  [/\s*נקודתיים\b/g, ':'],
  [/\s*נקודה\b/g, '.'],
  [/\s*פסיק\b/g, ','],
]

export function cleanText(raw: string): string {
  // drop invisible direction marks the model sometimes emits, and results with no letters at all
  let t = raw.replace(/[‎‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim()
  if (!/[\p{L}\p{N}]/u.test(t)) return ''
  for (const r of settings.replacements) {
    if (!r.from.trim()) continue
    t = t.split(r.from.trim()).join(r.to)
  }
  if (settings.voiceCommands) {
    for (const [re, to] of COMMANDS) t = t.replace(re, to)
    t = t.replace(/([.,?!:])(?=[^\s\n.,?!:])/g, '$1 ')
  }
  return t
}

// ---------------- dictation session ----------------

class Dictation {
  active = $state(false)
  starting = $state(false)
  level = $state(0)
  speaking = $state(false)
  queue = $state(0)
  seconds = $state(0)
  lastMs = $state(0)

  private rec: Recorder | null = null
  private chain: Promise<void> = Promise.resolve()
  private timer: ReturnType<typeof setInterval> | null = null
  private onText: ((t: string) => void) | null = null

  async start(onText: (t: string) => void) {
    if (this.active || this.starting) return
    this.starting = true
    this.onText = onText
    try {
      await engine.prepare(settings.engine)
      this.rec = new Recorder({
        silenceMs: settings.silenceMs,
        maxPhraseSec: 24,
        sensitivity: settings.sensitivity,
        onPhrase: (a) => this.enqueue(a),
        onLevel: (l, s) => {
          this.level = l
          this.speaking = s
        },
        onSilence: (ms) => {
          if (settings.autoStopSec > 0 && ms >= settings.autoStopSec * 1000) this.stop()
        },
      })
      await this.rec.start()
      this.active = true
      this.seconds = 0
      this.timer = setInterval(() => this.seconds++, 1000)
      if (isNative && settings.keepScreenOn) Native.keepScreenOn({ on: true }).catch(() => {})
    } catch (e) {
      this.rec = null
      const msg = String((e as Error)?.message ?? e)
      throw new Error(/Permission|NotAllowed/i.test(msg) ? 'אין הרשאה למיקרופון. אשרו אותה בהגדרות המכשיר.' : msg)
    } finally {
      this.starting = false
    }
  }

  private enqueue(audio: Float32Array) {
    this.queue++
    this.chain = this.chain.then(async () => {
      try {
        const r = await engine.transcribe(audio)
        this.lastMs = r.ms
        const t = cleanText(r.text)
        if (t) this.onText?.(t)
      } catch (e) {
        console.error(e)
      } finally {
        this.queue--
      }
    })
  }

  async stop() {
    if (!this.active) return
    this.active = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.level = 0
    await this.rec?.stop()
    this.rec = null
    if (isNative) Native.keepScreenOn({ on: false }).catch(() => {})
  }
}

export const dictation = new Dictation()
