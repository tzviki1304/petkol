// Long recordings: the phone records to small files (native service, works with the screen off),
// and this queue transcribes them one by one, calmly, in the background. Progress is saved after
// every piece, so a crash or a closed app just resumes where it stopped.
import { Filesystem, Directory } from '@capacitor/filesystem'
import { isNative, Native } from '../native'
import { getMeta, setMeta } from '../db'
import { settings } from '../settings.svelte'
import { store, uid } from '../store.svelte'
import { engine, cleanText } from './engine.svelte'
import { tidyText } from '../tidy'

export interface Job {
  id: string
  noteId: string
  files: string[] // absolute paths of 16 kHz mono PCM16 pieces, in order
  done: number // how many pieces are finished
  attempts: number // failed tries on the current piece
  seconds: number
  status: 'recording' | 'queued' | 'working' | 'done' | 'error'
  created: number
  startedHtml?: number // top-level blocks the note had when the job started (the tidy-up touches only what came after)
  fresh?: boolean // the next text starts a new paragraph
}

/** The open editor, so text goes straight into what the user sees (and is not overwritten by the editor's own saves). */
export interface EditorBridge {
  noteId: string
  append: (text: string, newParagraph: boolean) => void
  getHtml: () => string
  setHtml: (html: string) => void
}

const META_KEY = 'jobs'
const MAX_ATTEMPTS = 3

class Jobs {
  list: Job[] = $state([])
  running = $state(false)
  recording = $state<{ noteId: string; seconds: number; level: number; dir: string } | null>(null)
  current = $state<{ jobId: string; piece: number; of: number; lastMs: number } | null>(null)

  private bridge: EditorBridge | null = null
  private loaded = false
  private listeners: { remove: () => Promise<void> }[] = []

  setBridge(b: EditorBridge | null) {
    this.bridge = b
  }

  async init() {
    if (this.loaded) return
    this.loaded = true
    this.list = ((await getMeta<Job[]>(META_KEY)) ?? []).filter((j) => j.status !== 'done')
    if (!isNative) return
    // a recording that was running when the app was killed: pick up what the service saved
    try {
      const st = await Native.recStatus()
      const rec = this.list.find((j) => j.status === 'recording')
      if (rec && !st.recording) {
        rec.files = st.files.length ? st.files : await this.listPieces(rec.id)
        rec.status = rec.files.length ? 'queued' : 'done'
      } else if (rec && st.recording) {
        this.recording = { noteId: rec.noteId, seconds: st.seconds, level: 0, dir: st.dir ?? '' }
        this.listen(rec)
      }
    } catch {}
    await this.save()
    this.kick()
  }

  forNote(noteId: string): Job | undefined {
    return this.list.find((j) => j.noteId === noteId && j.status !== 'done')
  }

  private async save() {
    await setMeta(META_KEY, $state.snapshot(this.list))
  }

  private async listPieces(jobId: string): Promise<string[]> {
    try {
      const dir = `rec/${jobId}`
      const r = await Filesystem.readdir({ path: dir, directory: Directory.Data })
      const base = (await Filesystem.getUri({ path: dir, directory: Directory.Data })).uri.replace(/^file:\/\//, '')
      return r.files
        .map((f) => f.name)
        .filter((n) => n.endsWith('.pcm'))
        .sort()
        .map((n) => `${base}/${n}`)
    } catch {
      return []
    }
  }

  // ---------- recording ----------
  async startRecording(noteId: string) {
    if (!isNative) throw new Error('הקלטה ארוכה זמינה רק באפליקציה לאנדרואיד.')
    if (this.recording) throw new Error('כבר יש הקלטה פעילה.')
    await Native.requestNotifications().catch(() => {})
    const job: Job = { id: uid(), noteId, files: [], done: 0, attempts: 0, seconds: 0, status: 'recording', created: Date.now() }
    const rel = `rec/${job.id}`
    await Filesystem.mkdir({ path: rel, directory: Directory.Data, recursive: true }).catch(() => {})
    const dir = (await Filesystem.getUri({ path: rel, directory: Directory.Data })).uri.replace(/^file:\/\//, '')
    let r: { ok: boolean }
    try {
      r = await Native.recStart({ dir, chunkSec: 28, minChunkSec: 12 })
    } catch (e) {
      const code = (e as { code?: string }).code
      throw new Error(
        code === 'NO_PERMISSION'
          ? 'אין הרשאה למיקרופון. אשרו אותה בהגדרות המכשיר.'
          : code === 'ALREADY_RECORDING'
            ? 'כבר יש הקלטה פעילה.'
            : 'לא הצלחתי להתחיל להקליט.',
      )
    }
    if (!r.ok) throw new Error('לא הצלחתי להתחיל להקליט. בדקו שיש הרשאה למיקרופון.')
    // started together with the recording (while the app is in front), so transcription can go on
    // in the background even if the recording is stopped from the notification
    Native.workStart({ title: 'פתקול', text: 'הקלטה ארוכה פעילה' }).catch(() => {})
    const n = store.note(noteId)
    const d = document.createElement('div')
    d.innerHTML = (this.bridge?.noteId === noteId ? this.bridge.getHtml() : n?.html ?? '').replace(/(<p><\/p>|<p><br><\/p>)\s*$/, '')
    job.startedHtml = d.children.length
    job.fresh = true
    this.list.push(job)
    await this.save()
    this.recording = { noteId, seconds: 0, level: 0, dir }
    this.listen(job)
  }

  private async listen(job: Job) {
    for (const l of this.listeners) await l.remove().catch(() => {})
    this.listeners = [
      await Native.addListener('recLevel', (d) => {
        if (this.recording) {
          this.recording.level = d.level ?? 0
          this.recording.seconds = d.seconds
        }
      }),
      await Native.addListener('recChunk', (d) => {
        const j = this.list.find((x) => x.id === job.id)
        if (j && d.file && !j.files.includes(d.file)) {
          j.files.push(d.file)
          j.seconds = d.seconds
          this.save()
          this.kick() // start transcribing finished pieces right away when the device is strong enough
        }
      }),
      await Native.addListener('recStopped', (d) => this.finishRecording(job.id, d.files ?? [], d.seconds)),
    ]
  }

  async stopRecording() {
    const rec = this.list.find((j) => j.status === 'recording')
    try {
      const r = await Native.recStop()
      if (rec) await this.finishRecording(rec.id, r.files, r.seconds)
    } catch {
      if (rec) await this.finishRecording(rec.id, await this.listPieces(rec.id), this.recording?.seconds ?? 0)
    }
  }

  private async finishRecording(jobId: string, files: string[], seconds: number) {
    for (const l of this.listeners) await l.remove().catch(() => {})
    this.listeners = []
    this.recording = null
    const j = this.list.find((x) => x.id === jobId)
    if (!j || j.status !== 'recording') return
    if (files.length) j.files = files
    j.seconds = seconds
    j.status = j.files.length ? 'queued' : 'done'
    await this.save()
    if (!j.files.length && !this.running) Native.workStop().catch(() => {})
    this.kick()
  }

  // ---------- transcription queue ----------
  private kickTimer: ReturnType<typeof setTimeout> | null = null

  kick() {
    if (this.kickTimer) return
    this.kickTimer = setTimeout(() => {
      this.kickTimer = null
      this.run()
    }, 300)
  }

  /** While recording, a weak device waits until the recording ends (recording + model together is too much). */
  private canWorkNow(j: Job): boolean {
    if (j.status !== 'recording') return true
    return !settings.calm && !(engine.ramMB && engine.ramMB <= 2600)
  }

  private async run() {
    if (this.running || store.locked) return
    const job = this.list.find((j) => (j.status === 'queued' || j.status === 'working' || j.status === 'recording') && j.done < j.files.length && this.canWorkNow(j))
    if (!job) return
    this.running = true
    try {
      if (isNative) {
        await Native.workStart({ title: 'פתקול מתמלל ברקע', text: 'מכין את המודל…' }).catch(() => {})
      }
      await engine.prepare(settings.engine === 'ivrit' && engine.status.ivrit !== 'missing' ? settings.engine : 'ozen')
      while (job.done < job.files.length && !store.locked) {
        if (job.status !== 'recording') job.status = 'working'
        const i = job.done
        this.current = { jobId: job.id, piece: i + 1, of: job.files.length, lastMs: this.current?.lastMs ?? 0 }
        if (isNative) {
          Native.workUpdate({ text: `קטע ${i + 1} מתוך ${job.files.length}${job.status === 'recording' ? ' (ההקלטה עוד נמשכת)' : ''}`, progress: i, max: job.files.length }).catch(() => {})
        }
        let text = ''
        try {
          const audio = await this.readPiece(job.files[i])
          if (audio.length > 8000 && !isSilent(audio)) {
            const r = await engine.transcribe(audio)
            this.current.lastMs = r.ms
            text = cleanText(r.text)
          }
          job.attempts = 0
        } catch (e) {
          console.error('piece failed', e)
          job.attempts++
          if (job.attempts < MAX_ATTEMPTS) {
            await this.save()
            await sleep(3000)
            continue
          }
          text = '[קטע שלא הצלחתי לתמלל]'
          job.attempts = 0
        }
        if (text) {
          this.deliver(job.noteId, text, !!job.fresh)
          job.fresh = false
        }
        job.done = i + 1
        await this.save()
        Filesystem.deleteFile({ path: 'file://' + job.files[i] }).catch(() => {})
        if (settings.calm) await sleep(1500) // let the CPU cool down between pieces
      }
      if (job.done >= job.files.length && job.status !== 'recording') {
        job.status = 'done'
        if (settings.tidyAfter) this.tidyNote(job)
        store.say('התמלול הסתיים ✓')
        Filesystem.rmdir({ path: `rec/${job.id}`, directory: Directory.Data, recursive: true }).catch(() => {})
      }
      await this.save()
    } catch (e) {
      console.error(e)
      store.say(String((e as Error).message || e))
      job.status = 'error'
      await this.save()
    } finally {
      this.current = null
      this.running = false
      const more = this.list.some((j) => (j.status === 'queued' || j.status === 'recording') && j.done < j.files.length)
      if (isNative && !this.recording && !more) Native.workStop().catch(() => {})
      this.list = this.list.filter((j) => j.status !== 'done')
      await this.save()
      if (this.list.some((j) => (j.status === 'queued' || j.status === 'recording') && j.done < j.files.length)) this.kick()
    }
  }

  async retry(jobId: string) {
    const j = this.list.find((x) => x.id === jobId)
    if (!j) return
    j.status = 'queued'
    j.attempts = 0
    await this.save()
    this.kick()
  }

  async cancel(jobId: string) {
    const j = this.list.find((x) => x.id === jobId)
    if (!j) return
    if (j.status === 'recording') await this.stopRecording()
    j.status = 'done'
    this.list = this.list.filter((x) => x.id !== jobId)
    await this.save()
    Filesystem.rmdir({ path: `rec/${jobId}`, directory: Directory.Data, recursive: true }).catch(() => {})
  }

  private async readPiece(path: string): Promise<Float32Array> {
    const r = await Filesystem.readFile({ path: 'file://' + path })
    const b64 = typeof r.data === 'string' ? r.data : await blobToB64(r.data)
    const bin = atob(b64)
    const n = bin.length >> 1
    const out = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)
      if (v >= 0x8000) v -= 0x10000
      out[i] = v / 32768
    }
    return out
  }

  /** Adds text to the note: into the open editor if there is one, otherwise straight into the saved note. */
  private deliver(noteId: string, text: string, newParagraph: boolean) {
    if (this.bridge?.noteId === noteId) return this.bridge.append(text, newParagraph)
    const n = store.note(noteId)
    if (!n) return
    const html = appendToHtml(n.html, text, newParagraph)
    const div = document.createElement('div')
    div.innerHTML = html
    store.updateNote(noteId, { html, text: (div.innerText || div.textContent || '').trim() })
  }

  /** Tidies only the paragraphs this recording added (counted in top-level blocks, not characters). */
  private tidyNote(job: Job) {
    const b = this.bridge?.noteId === job.noteId ? this.bridge : null
    const n = store.note(job.noteId)
    if (!n) return
    const div = document.createElement('div')
    div.innerHTML = b ? b.getHtml() : n.html
    const blocks = [...div.children]
    const from = Math.min(job.startedHtml ?? 0, blocks.length)
    const mine = blocks.slice(from)
    const raw = mine.map((el) => el.textContent ?? '').join('\n\n')
    const tidy = tidyText(raw, { punctuation: true, paragraphs: true, fillers: true, structure: false, typography: true })
    if (!tidy.html.trim()) return
    for (const el of mine) el.remove()
    div.insertAdjacentHTML('beforeend', tidy.html)
    const html = div.innerHTML
    if (b) return b.setHtml(html)
    store.updateNote(job.noteId, { html, text: (div.textContent ?? '').trim() })
  }
}

/** Continues the last paragraph while a sentence is open, otherwise starts a new paragraph. */
export function appendToHtml(html: string, text: string, newParagraph = false): string {
  const parts = text.split(/\n+/).filter((p) => p.trim())
  let out = html.replace(/(<p><\/p>|<p><br><\/p>)\s*$/, '')
  for (const [i, part] of parts.entries()) {
    const m = out.match(/<p>([^<]*)<\/p>\s*$/)
    const last = m && !(newParagraph && i === 0) ? m[1] : null
    if (last !== null && last.length < 700 && !/[.?!:]["״']?\s*$/.test(last)) {
      out = out.slice(0, out.length - m![0].length) + `<p>${last}${last ? ' ' : ''}${escapeHtml(part)}</p>`
    } else {
      out += `<p>${escapeHtml(part)}</p>`
    }
  }
  return out
}

function escapeHtml(s: string) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
}

/** A piece with no speech at all (the loudest half-second stays very quiet) is skipped: models invent text on silence. */
function isSilent(a: Float32Array): boolean {
  const win = 8000
  let best = 0
  for (let s = 0; s + win <= a.length; s += win) {
    let sum = 0
    for (let i = s; i < s + win; i++) sum += a[i] * a[i]
    best = Math.max(best, Math.sqrt(sum / win))
  }
  return best < 0.008
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function blobToB64(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(String(fr.result).split(',')[1] ?? '')
    fr.onerror = rej
    fr.readAsDataURL(b)
  })
}

export const jobs = new Jobs()
;(globalThis as Record<string, unknown>).__petkol = { ...((globalThis as Record<string, unknown>).__petkol as object), jobs, store }
