// "סידור טקסט": turns raw or dictated Hebrew text into a clean, readable note.
// Fully offline, rule based: spacing, punctuation, Hebrew typography, paragraphs, headings and lists.

export interface TidyOptions {
  punctuation: boolean // close sentences, question marks for questions
  paragraphs: boolean // split long blocks into readable paragraphs
  fillers: boolean // drop "אממ", "אהה", repeated words
  structure: boolean // headings and lists from short lines / bullets
  typography: boolean // ״ ׳ – and spacing
  emphasis?: boolean // bold quotes, labels ("הערה:") and key sentences ("חשוב…", "לסיכום…")
  style?: LayoutStyle // page look: fonts for headings and body, alignment
}

export type LayoutStyle = 'none' | 'modern' | 'classic' | 'book'

export const LAYOUTS: { id: LayoutStyle; label: string; hint: string }[] = [
  { id: 'none', label: 'כמו שהוא', hint: 'בלי לשנות גופנים' },
  { id: 'modern', label: 'מודרני', hint: 'נקי וקליל' },
  { id: 'classic', label: 'קלאסי', hint: 'כותרות בולטות, גופן עם סריפים' },
  { id: 'book', label: 'ספר', hint: 'מיושר לשני הצדדים, כמו בדף של ספר' },
]

const STYLE_FONTS: Record<Exclude<LayoutStyle, 'none'>, { head: string; body: string; justify: boolean }> = {
  modern: { head: 'Rubik', body: 'Assistant', justify: false },
  classic: { head: 'Suez One', body: 'Frank Ruhl Libre', justify: false },
  book: { head: 'Frank Ruhl Libre', body: 'David Libre', justify: true },
}

export const defaultTidy: TidyOptions = { punctuation: true, paragraphs: true, fillers: true, structure: true, typography: true, emphasis: false, style: 'none' }

const QUESTION_START = /^(האם|מה|מי|למה|מדוע|איך|כיצד|מתי|איפה|היכן|לאן|מאין|כמה|איזה|איזו|אילו|באיזה|באיזו|ממה|על מה|עם מי|של מי|למי|ממי|נכון ש)(?=\s|$)/
const FILLERS = /(^|\s)(אמ+|אממ+|אה+|אהה+|אהם+|הממ+|ממ+|אוקיי אוקיי)(?=[\s,.?!]|$)/g

export function tidyText(raw: string, o: TidyOptions = defaultTidy): { html: string; text: string } {
  let text = raw.replace(/\r\n?/g, '\n').replace(/ /g, ' ')

  if (o.fillers) {
    text = text.replace(FILLERS, '$1')
    // "אני אני הולך" -> "אני הולך" (a dictation stutter)
    text = text.replace(/(^|\s)([֐-׿\w]{2,})(\s+\2)+(?=[\s,.?!]|$)/g, '$1$2')
  }

  // split into blocks (blank line = new block), then lines
  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean))
    .filter((b) => b.length)

  const out: string[] = []
  const plain: string[] = []
  const look = o.style && o.style !== 'none' ? STYLE_FONTS[o.style] : null
  const font = (family: string, html: string) => `<span style="font-family: &quot;${family}&quot;, &quot;Assistant&quot;, system-ui, sans-serif">${html}</span>`
  const body = (t: string) => {
    const h = o.emphasis ? emphasize(esc(t)) : esc(t)
    return look ? font(look.body, h) : h
  }
  const head = (t: string) => (look ? font(look.head, esc(t)) : esc(t))
  const pOpen = look?.justify ? '<p style="text-align: justify">' : '<p>'
  let titled = false

  for (const [bi, lines] of blocks.entries()) {
    // lists: every line starts with a bullet or a number
    const bullet = /^([-*•·–]\s+|\d{1,3}[.)]\s+|[א-י][.)]\s+)/
    if (o.structure && lines.length >= 2 && lines.every((l) => bullet.test(l))) {
      const ordered = lines.every((l) => /^\d/.test(l))
      const items = lines.map((l) => fixSentence(l.replace(bullet, ''), o, false))
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((i) => `<li><p>${body(i)}</p></li>`).join('')}</${ordered ? 'ol' : 'ul'}>`)
      plain.push(items.map((i) => '• ' + i).join('\n'))
      continue
    }

    let rest = lines
    // heading: a short line without closing punctuation, followed by more text (or a block of its own)
    if (o.structure && isHeading(lines[0]) && (lines.length >= 2 || (blocks[bi + 1] && lines[0].length <= 40))) {
      const h = typo(lines[0].replace(/[:：]\s*$/, ''), o)
      // with a page style, the very first heading becomes the title of the note
      const tag = look && !titled && bi === 0 ? 'h2' : 'h3'
      titled = true
      out.push(`<${tag}${tag === 'h2' ? ' style="text-align: center"' : ''}>${head(h)}</${tag}>`)
      plain.push(h)
      rest = lines.slice(1)
      if (!rest.length) continue
    }

    // a block that is all one quotation → a quote block
    if (o.structure && rest.length === 1 && /^["״„“].{20,}["״”]$/.test(rest[0])) {
      const q = typo(rest[0], o)
      out.push(`<blockquote><p>${body(q)}</p></blockquote>`)
      plain.push(q)
      continue
    }

    // within a block, separate lines are usually separate sentences (dictation pieces, copied lines)
    const joined = rest.map((l) => fixSentence(l, o, true)).join(' ')
    const sentences = splitSentences(joined)
    const paras = o.paragraphs ? groupParagraphs(sentences) : [sentences]
    for (const p of paras) {
      const t = p.join(' ').trim()
      if (!t) continue
      out.push(`${pOpen}${body(t)}</p>`)
      plain.push(t)
    }
  }

  return { html: out.join(''), text: plain.join('\n\n') }
}

/** Bold where a reader's eye should land: quotations, "label:" openings and key sentences. Input is escaped HTML. */
function emphasize(h: string): string {
  // quotations: "…" ״…״ „…“
  h = h.replace(/(["״„“])([^"״„“”]{3,80})(["״”])/g, '$1<strong>$2</strong>$3')
  // a short label that opens a sentence: "הערה: …", "שאלה: …"
  h = h.replace(/(^|[.!?]\s+)([^\s.,!?:]{2,}(?:\s[^\s.,!?:]{2,}){0,2}):(?=\s)/g, '$1<strong>$2:</strong>')
  // key sentences
  h = h.replace(/(^|[.!?]\s+)((?:חשוב|חשוב מאוד|שים לב|שימו לב|העיקר|הנקודה|המסקנה|לסיכום|בשורה התחתונה|זכור|זכרו)(?=[\s,:])[^.!?]*[.!?]?)/g, '$1<strong>$2</strong>')
  return h
}

function isHeading(line: string): boolean {
  const words = line.split(/\s+/).length
  return words <= 7 && line.length <= 60 && !/[.,?!;]$/.test(line)
}

function fixSentence(s: string, o: TidyOptions, closeIt: boolean): string {
  let t = typo(s.trim(), o)
  if (!t) return t
  if (o.punctuation) {
    // spaces: none before punctuation, one after
    t = t.replace(/\s+([,.?!:;])/g, '$1').replace(/([,.?!:;])(?=[^\s\d"״'׳)\]])/g, '$1 ')
    // a question word opening a sentence that ends with a period -> question mark
    t = t.replace(/(^|[.!?]\s+)([^.!?]+?)\.(?=\s|$)/g, (m, pre, body) => (QUESTION_START.test(body.trim()) ? `${pre}${body}?` : m))
    if (closeIt && !/[.?!:;…"״)]$/.test(t)) t += QUESTION_START.test(lastSentence(t)) ? '?' : '.'
  }
  return t
}

function lastSentence(t: string): string {
  const parts = t.split(/[.?!]\s+/)
  return (parts[parts.length - 1] ?? '').trim()
}

function typo(s: string, o: TidyOptions): string {
  if (!o.typography) return s
  return s
    .replace(/([א-ת])"([א-ת])/g, '$1״$2') // צה"ל -> צה״ל
    .replace(/([א-ת])'(?=[\s,.?!]|$)/g, '$1׳') // ג' -> ג׳
    .replace(/\s-\s/g, ' – ')
    .replace(/\.{3,}/g, '…')
    .replace(/\s{2,}/g, ' ')
}

function splitSentences(t: string): string[] {
  const out: string[] = []
  const re = /[^.?!…]+[.?!…]+["״')]*\s*|[^.?!…]+$/g
  for (const m of t.matchAll(re)) {
    const s = m[0].trim()
    if (s) out.push(s)
  }
  return out
}

/** About 3–4 sentences or ~450 characters per paragraph; a "new topic" word starts a new one. */
function groupParagraphs(sentences: string[]): string[][] {
  const paras: string[][] = []
  let cur: string[] = []
  let len = 0
  const newTopic = /^(עכשיו|ועכשיו|דבר נוסף|עוד דבר|בנוסף|לסיכום|לכן|אבל|מצד שני|נעבור|השאלה|בקיצור)(?=\s|$)/
  for (const s of sentences) {
    if (cur.length && (len + s.length > 450 || cur.length >= 4 || (newTopic.test(s) && cur.length >= 2))) {
      paras.push(cur)
      cur = []
      len = 0
    }
    cur.push(s)
    len += s.length
  }
  if (cur.length) paras.push(cur)
  return paras
}

function esc(s: string) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
}
