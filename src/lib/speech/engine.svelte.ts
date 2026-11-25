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

// Android runs the model natively (ONNX Runtime, several threads) where the fp32 encoder is the fastest.
// The browser build uses the smaller fp16 encoder through WASM.
const OZEN_ENCODER: 'fp16' | 'fp32' = isNative ? 'fp32' : 'fp16'
const HF_OZEN = 'https://huggingface.co/itayinbar/Ozen-v1/resolve/main/'
const ozenFiles = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  OZEN_ENCODER === 'fp16' ? 'onnx/encoder_model_fp16.onnx' : 'onnx/encoder_model.onnx',
  'onnx/decoder_model_merged.onnx',
]

export const MODELS: ModelDef[] = [
  {
    id: 'ozen',
    name: 'אוזן: מודל רגיל',
    short: 'רגיל',
    description: 'מהיר וקל, מתאים לכל מכשיר. עברית בלבד, דיוק טוב מאוד לדיבור רגיל.',
    sizeMB: isNative ? 245 : 165,
    minRamMB: 1500,
    files: ozenFiles.map((f) => ({ path: `ozen-v1/${f}`, urls: [HF_OZEN + f, MIRROR + 'ozen-v1__' + f.replace('/', '__')] })),
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

export type ModelStatus = 'missing' | 'downloading' | 'downloaded' | 'loading' | 'ready' | 'error'

class SpeechEngine {
  status = $state<Record<EngineId, ModelStatus>>({ ozen: 'missing', ivrit: 'missing' })
  progress = $state<Record<EngineId, number>>({ ozen: 0, ivrit: 0 })
  error = $state<string>('')
  ramMB = $state(0)

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
        this.ramMB = (await Native.deviceInfo()).totalRamMB
      } catch {}
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
    this.cancelDownload = false
    const total = m.sizeMB * 1024 * 1024
    let doneBytes = 0
    try {
      for (const f of m.files) {
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
      this.status[id] = 'downloaded'
      this.markDone(id, true)
    } catch (e) {
      this.status[id] = 'error'
      this.error = 'ההורדה נכשלה. בדקו חיבור לאינטרנט ונסו שוב.'
      console.error(e)
    }
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
    this.status[id] = isNative ? 'missing' : 'downloaded'
    if (settings.engine === id) settings.engine = 'ozen'
  }

  private disposeWorker() {
    this.worker?.terminate()
    this.worker = null
    this.workerReady = null
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
      await this.startWorker()
      if (isNative && !this.ozenNative) {
        this.status.ozen = 'loading'
        const uri = await Filesystem.getUri({ path: 'models/ozen-v1', directory: Directory.Data })
        try {
          const r = await Native.ozenLoad({ dir: uri.uri.replace(/^file:\/\//, ''), threads: Math.min(4, navigator.hardwareConcurrency || 4) })
          if (!r.ok) throw new Error('load failed')
          this.ozenNative = true
          this.status.ozen = 'ready'
        } catch (e) {
          this.status.ozen = 'downloaded'
          throw new Error('טעינת המודל נכשלה. נסו למחוק ולהוריד אותו מחדש.')
        }
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
        const r = await Native.whisperLoad({ path })
        if (!r.ok) throw new Error('load failed')
        this.nativeLoaded = 'ivrit'
        this.status.ivrit = 'ready'
      } catch (e) {
        this.status.ivrit = 'downloaded'
        throw new Error('טעינת המודל המדויק נכשלה, כנראה אין מספיק זיכרון. נסו את המודל הרגיל.')
      }
    }
  }

  private async startWorker() {
    if (this.workerReady) return this.workerReady
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
          if (!isNative) this.status.ozen = 'ready'
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
        encoder: OZEN_ENCODER,
        textOnly: isNative,
        threads: Math.min(4, navigator.hardwareConcurrency || 2),
      })
    })
    return this.workerReady
  }

  async transcribe(audio: Float32Array): Promise<{ text: string; ms: number }> {
    const id = settings.engine
    await this.prepare(id)
    if (id === 'ivrit') {
      const r = await Native.whisperTranscribe({ audio: float32ToB64(audio), language: 'he', prompt: settings.vocabulary || undefined })
      return { text: r.text.trim(), ms: r.ms }
    }
    if (isNative) {
      const t0 = performance.now()
      const f = await this.ask<{ features: Float32Array }>({ type: 'features', audio }, [audio.buffer])
      const r = await Native.ozenRun({ features: float32ToB64(f.features), maxTokens: 220 })
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
  let t = raw.replace(/\s+/g, ' ').trim()
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
