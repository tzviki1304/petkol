import { Share } from '@capacitor/share'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { isNative, Native } from './native'
import { embeddedFontCss, fontStack } from './fonts.svelte'
import { settings } from './settings.svelte'
import { displayTitle, store } from './store.svelte'
import type { Note } from './types'

function safeName(s: string) {
  return (s.replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim().slice(0, 60) || 'הערה').replace(/\s+/g, ' ')
}

function usedFonts(html: string): string[] {
  const out = new Set<string>([settings.editorFont])
  for (const m of html.matchAll(/font-family:\s*([^;"]+)/g)) {
    out.add(m[1].split(',')[0].replace(/["']/g, '').trim())
  }
  return [...out]
}

export async function noteHtmlDocument(n: Note): Promise<string> {
  const css = await embeddedFontCss(usedFonts(n.html))
  const title = displayTitle(n)
  const titleBlock = n.title.trim() ? `<h1 class="doc-title">${escapeHtml(title)}</h1>` : ''
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>${css}
@page { size: A4; margin: 18mm 16mm; }
body { font-family: ${fontStack(settings.editorFont)}; font-size: 12.5pt; line-height: 1.65; color: #1a1a1a; direction: rtl; }
.doc-title { font-size: 22pt; margin: 0 0 10pt; }
h1 { font-size: 20pt; } h2 { font-size: 16pt; } h3 { font-size: 13.5pt; }
blockquote { border-inline-start: 3px solid #bbb; margin: 0; padding-inline-start: 12pt; color: #444; }
ul[data-type="taskList"] { list-style: none; padding-inline-start: 0; }
ul[data-type="taskList"] li { display: flex; gap: 8pt; align-items: baseline; }
ul[data-type="taskList"] li > label input { width: 11pt; height: 11pt; }
ul[data-type="taskList"] li[data-checked="true"] > div { text-decoration: line-through; color: #777; }
mark { background: #fde68a; padding: 0 2px; }
hr { border: none; border-top: 1px solid #ccc; margin: 14pt 0; }
p { margin: 0 0 6pt; }
</style></head><body>${titleBlock}${n.html}</body></html>`
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

export async function exportPdf(n: Note, share = true) {
  const html = await noteHtmlDocument(n)
  const name = safeName(displayTitle(n))
  if (isNative) {
    const { path } = await Native.htmlToPdf({ html, fileName: name + '.pdf' })
    if (share) await Share.share({ title: name, files: ['file://' + path.replace(/^file:\/\//, '')], dialogTitle: 'שיתוף PDF' })
    return path
  }
  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(html)
  w.document.close()
  setTimeout(() => w.print(), 400)
}

export async function shareText(n: Note) {
  const title = displayTitle(n)
  const body = n.title.trim() ? `${n.title.trim()}\n\n${n.text}` : n.text
  if (isNative) {
    await Share.share({ title, text: body, dialogTitle: 'שיתוף הערה' })
  } else if (navigator.share) {
    await navigator.share({ title, text: body }).catch(() => {})
  } else {
    await navigator.clipboard.writeText(body)
    store.say('הטקסט הועתק')
  }
}

export async function copyText(n: Note) {
  const body = n.title.trim() ? `${n.title.trim()}\n\n${n.text}` : n.text
  await navigator.clipboard.writeText(body)
  store.say('ההערה הועתקה')
}

export async function exportBackup() {
  const json = store.exportJson()
  const d = new Date()
  const name = `petkol-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`
  if (isNative) {
    const r = await Filesystem.writeFile({ path: name, data: json, directory: Directory.Cache, encoding: Encoding.UTF8 })
    await Share.share({ title: 'גיבוי פתקול', files: [r.uri], dialogTitle: 'שמירת הגיבוי' })
  } else {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    a.download = name
    a.click()
  }
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}
