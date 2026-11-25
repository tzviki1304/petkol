import * as db from './db'
import { createLock, openLock, encryptString, decryptString, type LockMeta } from './crypto'
import type { Folder, Note, StoredItem, View } from './types'
import { settings } from './settings.svelte'

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

class Store {
  folders: Folder[] = $state([])
  notes: Note[] = $state([])
  ready = $state(false)
  hasLock = $state(false)
  locked = $state(false)
  stack: View[] = $state([{ name: 'library', folderId: null }])
  toast = $state<{ text: string; id: number } | null>(null)

  private key: CryptoKey | null = null
  private lockMeta: LockMeta | null = null
  private saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

  get view(): View {
    return this.stack[this.stack.length - 1]
  }

  // ---------- startup / lock ----------
  async init() {
    this.lockMeta = (await db.getMeta<LockMeta>('lock')) ?? null
    this.hasLock = !!this.lockMeta
    if (this.hasLock) {
      this.locked = true
    } else {
      await this.loadAll()
      if (!(await db.getMeta('seeded'))) await this.seed()
    }
    this.ready = true
  }

  private async seed() {
    await db.setMeta('seeded', true)
    if (this.folders.length || this.notes.length) return
    const now = Date.now()
    const general: Folder = { id: uid(), name: 'כללי', parentId: null, created: now, updated: now }
    this.folders.push(general)
    await this.persistFolder(general)
    const welcome: Note = {
      id: uid(),
      folderId: null,
      title: '',
      html:
        '<h2>ברוכים הבאים לפתקול</h2><p>כאן כותבים הערות, מסדרים אותן בתיקיות, ו<strong>מדברים במקום להקליד</strong>.</p><ul><li><p>לחצו על כפתור המיקרופון בתחתית ההערה ודברו בחופשיות.</p></li><li><p>הדיבור מתומלל על המכשיר עצמו, בלי אינטרנט.</p></li><li><p>בהגדרות אפשר לבחור גופן, גודל, ערכת צבעים, סיסמה ועוד.</p></li></ul><p>אפשר למחוק את ההערה הזאת בכל רגע.</p>',
      text: '',
      created: now,
      updated: now,
    }
    welcome.text = htmlToText(welcome.html)
    this.notes.push(welcome)
    await this.persistNote(welcome)
  }

  private async decode(item: StoredItem): Promise<Note | Folder | null> {
    if (item.plain) return item.plain
    if (item.iv && item.data && this.key) {
      try {
        return JSON.parse(await decryptString(this.key, item.iv, item.data))
      } catch {
        return null
      }
    }
    return null
  }

  private async encode(kind: 'note' | 'folder', obj: Note | Folder): Promise<StoredItem> {
    if (this.key) {
      const { iv, data } = await encryptString(this.key, JSON.stringify(obj))
      return { id: obj.id, kind, iv, data }
    }
    return { id: obj.id, kind, plain: obj }
  }

  private async loadAll() {
    const items = await db.allItems()
    const folders: Folder[] = []
    const notes: Note[] = []
    for (const it of items) {
      const v = await this.decode(it)
      if (!v) continue
      if (it.kind === 'folder') folders.push(v as Folder)
      else notes.push(v as Note)
    }
    this.folders = folders
    this.notes = notes
    this.purgeOldTrash()
  }

  async unlock(password: string): Promise<boolean> {
    if (!this.lockMeta) return true
    const key = await openLock(password, this.lockMeta)
    if (!key) return false
    this.key = key
    await this.loadAll()
    this.locked = false
    return true
  }

  lock() {
    if (!this.hasLock) return
    this.flushSaves()
    this.key = null
    this.folders = []
    this.notes = []
    this.locked = true
    this.stack = [{ name: 'library', folderId: null }]
  }

  async setPassword(password: string) {
    const { key, meta } = await createLock(password)
    this.key = key
    this.lockMeta = meta
    await this.rewriteAll()
    await db.setMeta('lock', meta)
    this.hasLock = true
  }

  async removePassword() {
    this.key = null
    this.lockMeta = null
    await this.rewriteAll()
    await db.delMeta('lock')
    this.hasLock = false
  }

  async checkPassword(password: string): Promise<boolean> {
    if (!this.lockMeta) return true
    return !!(await openLock(password, this.lockMeta))
  }

  private async rewriteAll() {
    const items: StoredItem[] = []
    for (const f of this.folders) items.push(await this.encode('folder', $state.snapshot(f) as Folder))
    for (const n of this.notes) items.push(await this.encode('note', $state.snapshot(n) as Note))
    await db.putItems(items)
  }

  // ---------- persistence ----------
  private async persistFolder(f: Folder) {
    await db.putItem(await this.encode('folder', $state.snapshot(f) as Folder))
  }

  private async persistNote(n: Note) {
    await db.putItem(await this.encode('note', $state.snapshot(n) as Note))
  }

  scheduleSave(n: Note, delay = 600) {
    const t = this.saveTimers.get(n.id)
    if (t) clearTimeout(t)
    this.saveTimers.set(
      n.id,
      setTimeout(() => {
        this.saveTimers.delete(n.id)
        this.persistNote(n)
      }, delay),
    )
  }

  flushSaves() {
    for (const [id, t] of this.saveTimers) {
      clearTimeout(t)
      const n = this.notes.find((x) => x.id === id)
      if (n) this.persistNote(n)
    }
    this.saveTimers.clear()
  }

  // ---------- navigation ----------
  go(v: View) {
    this.stack.push(v)
  }

  replace(v: View) {
    this.stack[this.stack.length - 1] = v
  }

  back(): boolean {
    if (this.stack.length > 1) {
      this.stack.pop()
      return true
    }
    const v = this.view
    if (v.name === 'library' && v.folderId) {
      const f = this.folder(v.folderId)
      this.replace({ name: 'library', folderId: f?.parentId ?? null })
      return true
    }
    return false
  }

  say(text: string) {
    this.toast = { text, id: Date.now() }
  }

  // ---------- queries ----------
  folder(id: string | null): Folder | undefined {
    return id ? this.folders.find((f) => f.id === id) : undefined
  }

  note(id: string): Note | undefined {
    return this.notes.find((n) => n.id === id)
  }

  childFolders(parentId: string | null): Folder[] {
    const list = this.folders.filter((f) => f.parentId === parentId && !f.trashed)
    return list.sort((a, b) => a.name.localeCompare(b.name, 'he'))
  }

  notesIn(folderId: string | null): Note[] {
    const list = this.notes.filter((n) => n.folderId === folderId && !n.trashed)
    return sortNotes(list)
  }

  path(folderId: string | null): Folder[] {
    const out: Folder[] = []
    let f = this.folder(folderId)
    let guard = 0
    while (f && guard++ < 50) {
      out.unshift(f)
      f = this.folder(f.parentId)
    }
    return out
  }

  countIn(folderId: string): number {
    const ids = new Set([folderId, ...this.descendants(folderId).map((f) => f.id)])
    return this.notes.filter((n) => !n.trashed && n.folderId && ids.has(n.folderId)).length
  }

  descendants(folderId: string): Folder[] {
    const out: Folder[] = []
    const walk = (id: string) => {
      for (const f of this.folders) if (f.parentId === id) { out.push(f); walk(f.id) }
    }
    walk(folderId)
    return out
  }

  search(q: string): Note[] {
    const t = q.trim()
    if (!t) return []
    const words = t.split(/\s+/)
    return sortNotes(
      this.notes.filter((n) => !n.trashed && words.every((w) => n.title.includes(w) || n.text.includes(w))),
    )
  }

  trashed(): { folders: Folder[]; notes: Note[] } {
    return {
      folders: this.folders.filter((f) => f.trashed),
      notes: this.notes.filter((n) => n.trashed).sort((a, b) => (b.trashed ?? 0) - (a.trashed ?? 0)),
    }
  }

  // ---------- mutations ----------
  async createFolder(name: string, parentId: string | null): Promise<Folder> {
    const now = Date.now()
    const f: Folder = { id: uid(), name: name.trim() || 'תיקייה חדשה', parentId, created: now, updated: now }
    this.folders.push(f)
    await this.persistFolder(f)
    return f
  }

  async renameFolder(id: string, name: string) {
    const f = this.folder(id)
    if (!f) return
    f.name = name.trim() || f.name
    f.updated = Date.now()
    await this.persistFolder(f)
  }

  async moveFolder(id: string, parentId: string | null) {
    const f = this.folder(id)
    if (!f || id === parentId) return
    if (parentId && this.descendants(id).some((d) => d.id === parentId)) return
    f.parentId = parentId
    f.updated = Date.now()
    await this.persistFolder(f)
  }

  async trashFolder(id: string) {
    const f = this.folder(id)
    if (!f) return
    const now = Date.now()
    f.trashed = now
    await this.persistFolder(f)
    const ids = new Set([id, ...this.descendants(id).map((d) => d.id)])
    for (const n of this.notes) {
      if (n.folderId && ids.has(n.folderId) && !n.trashed) {
        n.trashed = now
        await this.persistNote(n)
      }
    }
  }

  async createNote(folderId: string | null, html = ''): Promise<Note> {
    const now = Date.now()
    const n: Note = { id: uid(), folderId, title: '', html, text: htmlToText(html), created: now, updated: now }
    this.notes.push(n)
    await this.persistNote(n)
    return this.notes[this.notes.length - 1]
  }

  updateNote(id: string, patch: Partial<Note>) {
    const n = this.note(id)
    if (!n) return
    Object.assign(n, patch, { updated: Date.now() })
    this.scheduleSave(n)
  }

  async moveNote(id: string, folderId: string | null) {
    const n = this.note(id)
    if (!n) return
    n.folderId = folderId
    n.updated = Date.now()
    await this.persistNote(n)
  }

  async togglePin(id: string) {
    const n = this.note(id)
    if (!n) return
    n.pinned = !n.pinned
    await this.persistNote(n)
  }

  async trashNote(id: string) {
    const n = this.note(id)
    if (!n) return
    n.trashed = Date.now()
    await this.persistNote(n)
  }

  async restoreNote(id: string) {
    const n = this.note(id)
    if (!n) return
    delete n.trashed
    if (n.folderId) {
      const f = this.folder(n.folderId)
      if (!f || f.trashed) n.folderId = null
    }
    await this.persistNote(n)
  }

  async restoreFolder(id: string) {
    const f = this.folder(id)
    if (!f) return
    const when = f.trashed
    delete f.trashed
    const p = this.folder(f.parentId)
    if (f.parentId && (!p || p.trashed)) f.parentId = null
    await this.persistFolder(f)
    const ids = new Set([id, ...this.descendants(id).map((d) => d.id)])
    for (const n of this.notes) {
      if (n.folderId && ids.has(n.folderId) && n.trashed === when) {
        delete n.trashed
        await this.persistNote(n)
      }
    }
  }

  async deleteForever(kind: 'note' | 'folder', id: string) {
    if (kind === 'note') {
      this.notes = this.notes.filter((n) => n.id !== id)
      await db.deleteItem(id)
    } else {
      const ids = [id, ...this.descendants(id).map((d) => d.id)]
      for (const fid of ids) {
        for (const n of this.notes.filter((x) => x.folderId === fid)) await db.deleteItem(n.id)
        this.notes = this.notes.filter((x) => x.folderId !== fid)
        await db.deleteItem(fid)
      }
      this.folders = this.folders.filter((f) => !ids.includes(f.id))
    }
  }

  async emptyTrash() {
    const t = this.trashed()
    for (const n of t.notes) await this.deleteForever('note', n.id)
    for (const f of t.folders) if (this.folder(f.id)) await this.deleteForever('folder', f.id)
  }

  private purgeOldTrash() {
    const limit = Date.now() - 30 * 24 * 3600 * 1000
    for (const n of this.notes) if (n.trashed && n.trashed < limit) this.deleteForever('note', n.id)
    for (const f of this.folders) if (f.trashed && f.trashed < limit) this.deleteForever('folder', f.id)
  }

  // ---------- backup ----------
  exportJson(): string {
    return JSON.stringify(
      { app: 'petkol', version: 1, exported: Date.now(), folders: $state.snapshot(this.folders), notes: $state.snapshot(this.notes) },
      null,
      1,
    )
  }

  async importJson(text: string): Promise<{ folders: number; notes: number }> {
    const data = JSON.parse(text)
    if (data?.app !== 'petkol' || !Array.isArray(data.notes)) throw new Error('bad file')
    const known = new Set([...this.folders.map((f) => f.id), ...this.notes.map((n) => n.id)])
    let fc = 0
    let nc = 0
    for (const f of data.folders as Folder[]) {
      if (known.has(f.id)) continue
      this.folders.push(f)
      await this.persistFolder(f)
      fc++
    }
    for (const n of data.notes as Note[]) {
      if (known.has(n.id)) continue
      this.notes.push(n)
      await this.persistNote(n)
      nc++
    }
    return { folders: fc, notes: nc }
  }
}

export function sortNotes(list: Note[]): Note[] {
  const by = settings.sortBy
  return list.sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1
    if (by === 'title') return displayTitle(a).localeCompare(displayTitle(b), 'he')
    if (by === 'created') return b.created - a.created
    return b.updated - a.updated
  })
}

export function htmlToText(html: string): string {
  const d = document.createElement('div')
  d.innerHTML = html.replace(/<\/(p|h[1-6]|li|blockquote)>/g, '</$1>\n')
  return (d.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}

export function displayTitle(n: Note): string {
  if (n.title.trim()) return n.title.trim()
  const first = n.text.split('\n').find((l) => l.trim())
  return first ? first.trim().slice(0, 80) : 'הערה ללא כותרת'
}

export function previewText(n: Note): string {
  const lines = n.text.split('\n').filter((l) => l.trim())
  if (!n.title.trim()) lines.shift()
  return lines.join(' · ').slice(0, 240)
}

export function formatDate(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return 'אתמול'
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })
}

export const store = new Store()
