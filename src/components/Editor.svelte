<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { Editor } from '@tiptap/core'
  import StarterKit from '@tiptap/starter-kit'
  import { TextStyleKit } from '@tiptap/extension-text-style'
  import TextAlign from '@tiptap/extension-text-align'
  import Highlight from '@tiptap/extension-highlight'
  import { TaskList, TaskItem } from '@tiptap/extension-list'
  import { Placeholder, CharacterCount } from '@tiptap/extensions'
  import Icon from './Icon.svelte'
  import Sheet from './Sheet.svelte'
  import MenuItem from './MenuItem.svelte'
  import FolderPicker from './FolderPicker.svelte'
  import DictationBar from './DictationBar.svelte'
  import LongRecBar from './LongRecBar.svelte'
  import TidySheet from './TidySheet.svelte'
  import { jobs } from '../lib/speech/jobs.svelte'
  import { isNative } from '../lib/native'
  import { confirmDialog } from './Dialog.svelte'
  import { store, displayTitle, formatDate } from '../lib/store.svelte'
  import { settings } from '../lib/settings.svelte'
  import { allFontChoices, fontStack, fontLabel } from '../lib/fonts.svelte'
  import { exportPdf, shareText, copyText } from '../lib/exporter'
  import { dictation } from '../lib/speech/engine.svelte'
  import type { Paper } from '../lib/types'

  let { id, dictate = false, longRec = false }: { id: string; dictate?: boolean; longRec?: boolean } = $props()
  let tidyOpen = $state(false)

  const note = $derived(store.note(id))
  let el: HTMLDivElement | undefined = $state()
  let editor: Editor | null = $state(null)
  let tick = $state(0) // bumps on every transaction so the toolbar reflects the selection
  let words = $state(0)

  let menuOpen = $state(false)
  let fontOpen = $state(false)
  let headOpen = $state(false)
  let alignOpen = $state(false)
  let colorOpen = $state(false)
  let paperOpen = $state(false)
  let pickOpen = $state(false)
  let infoOpen = $state(false)
  let fmtVisible = $state(true)

  const paper: Paper = $derived(note?.paper ?? 'plain')
  const lh = $derived(settings.editorSize * settings.lineHeight)
  const pad = $derived(settings.pageMargin === 'narrow' ? 14 : settings.pageMargin === 'wide' ? 34 : 22)

  onMount(() => {
    if (!note || !el) return
    editor = new Editor({
      element: el,
      content: note.html || '',
      extensions: [
        StarterKit.configure({ link: { openOnClick: false } }),
        TextStyleKit,
        TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['right', 'center', 'left', 'justify'] }),
        Highlight.configure({ multicolor: true }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Placeholder.configure({ placeholder: 'מתחילים לכתוב… או לוחצים על המיקרופון ומדברים' }),
        CharacterCount,
      ],
      editorProps: {
        attributes: { class: 'prose', dir: 'rtl', spellcheck: String(settings.spellcheck) },
      },
      onTransaction: () => {
        tick++
      },
      onUpdate: ({ editor: ed }) => {
        words = ed.storage.characterCount.words()
        store.updateNote(id, { html: ed.getHTML(), text: ed.getText({ blockSeparator: '\n' }) })
      },
    })
    words = editor.storage.characterCount.words()
    jobs.setBridge({
      noteId: id,
      append: (t, newParagraph) => appendText(t, newParagraph),
      getHtml: () => editor?.getHTML() ?? '',
      setHtml: (html) => {
        editor?.commands.setContent(html, { emitUpdate: true })
      },
    })
    if (longRec) setTimeout(startLong, 250)
    else if (dictate) setTimeout(toggleMic, 250)
    else if (!note.text.trim() && !note.title.trim()) setTimeout(() => editor?.commands.focus('end'), 120)
  })

  onDestroy(() => {
    jobs.setBridge(null)
    dictation.stop()
    store.flushSaves()
    editor?.destroy()
    // throw away a note that was opened and never written in
    const n = store.note(id)
    if (n && !jobs.forNote(id) && !n.title.trim() && !n.text.trim() && !n.html.includes('data-type="taskList"')) store.deleteForever('note', id)
  })

  function is(name: string, attrs?: Record<string, unknown>) {
    void tick
    return editor?.isActive(name, attrs) ?? false
  }
  function canUndo() {
    void tick
    return editor?.can().undo() ?? false
  }
  function canRedo() {
    void tick
    return editor?.can().redo() ?? false
  }
  function chars() {
    void tick
    return editor?.storage.characterCount.characters() ?? 0
  }
  const chain = () => editor!.chain().focus()

  function currentSize(): number {
    void tick
    const s = editor?.getAttributes('textStyle').fontSize as string | undefined
    if (s) return parseFloat(s)
    if (editor?.isActive('heading', { level: 1 })) return Math.round(settings.editorSize * 1.75)
    if (editor?.isActive('heading', { level: 2 })) return Math.round(settings.editorSize * 1.4)
    if (editor?.isActive('heading', { level: 3 })) return Math.round(settings.editorSize * 1.17)
    return settings.editorSize
  }

  function size(delta: number) {
    const next = Math.max(10, Math.min(64, currentSize() + delta))
    chain().setFontSize(next + 'px').run()
  }

  function currentFont(): string {
    void tick
    const f = editor?.getAttributes('textStyle').fontFamily as string | undefined
    return f ? f.split(',')[0].replace(/["']/g, '').trim() : settings.editorFont
  }

  function setFont(family: string) {
    fontOpen = false
    if (family === settings.editorFont) chain().unsetFontFamily().run()
    else chain().setFontFamily(fontStack(family)).run()
  }

  function alignIcon() {
    void tick
    if (editor?.isActive({ textAlign: 'center' })) return 'alignCenter'
    if (editor?.isActive({ textAlign: 'left' })) return 'alignLeft'
    if (editor?.isActive({ textAlign: 'justify' })) return 'alignJustify'
    return 'alignRight'
  }

  const TEXT_COLORS = [
    { c: '', n: 'רגיל' },
    { c: '#b42318', n: 'אדום' },
    { c: '#c2643f', n: 'חימר' },
    { c: '#b7791f', n: 'ענבר' },
    { c: '#2f7a4f', n: 'ירוק' },
    { c: '#2f55a4', n: 'כחול' },
    { c: '#7a3f8f', n: 'סגול' },
    { c: '#6b6b6b', n: 'אפור' },
  ]
  const MARKS = [
    { c: '#fbe7a1', n: 'צהוב' },
    { c: '#cdebd3', n: 'ירוק' },
    { c: '#cfe0f7', n: 'כחול' },
    { c: '#f7d4dd', n: 'ורוד' },
    { c: '#e5dcf5', n: 'סגול' },
  ]

  // ---------- dictation ----------
  async function toggleMic() {
    if (dictation.active) return dictation.stop()
    try {
      await dictation.start(insertDictated)
    } catch (e) {
      store.say(String((e as Error).message))
      if (String((e as Error).message).includes('לא הורד')) store.go({ name: 'settings', section: 'dictation' })
    }
  }

  /** Text from a long recording: always at the end, continuing the open sentence or as a new paragraph. */
  function appendText(text: string, newParagraph: boolean) {
    const ed = editor
    if (!ed) return
    const parts = text.split(/\n+/).filter((x) => x.trim())
    parts.forEach((part, i) => {
      const last = ed.state.doc.lastChild
      const lastText = last?.textContent ?? ''
      const isPara = last?.type.name === 'paragraph'
      const cont = !(newParagraph && i === 0) && i === 0 && isPara && lastText.length > 0 && lastText.length < 700 && !/[.?!:]["״']?\s*$/.test(lastText)
      const size = ed.state.doc.content.size
      if (cont) {
        ed.commands.insertContentAt(size - 1, { type: 'text', text: ' ' + part })
      } else if (isPara && lastText.length === 0) {
        ed.commands.insertContentAt(size - 1, { type: 'text', text: part })
      } else {
        ed.commands.insertContentAt(size, { type: 'paragraph', content: [{ type: 'text', text: part }] })
      }
    })
  }

  function noteText(): string {
    return editor?.getText({ blockSeparator: '\n\n' }) ?? ''
  }

  async function startLong() {
    if (dictation.active) await dictation.stop()
    try {
      await jobs.startRecording(id)
    } catch (e) {
      store.say(String((e as Error).message))
    }
  }

  function applyTidy(html: string) {
    editor?.chain().focus().setContent(html, { emitUpdate: true }).run()
    store.say('הטקסט סודר ✓')
  }

  function insertDictated(text: string) {
    const ed = editor
    if (!ed) return
    if (settings.insertAt === 'end') ed.commands.setTextSelection(ed.state.doc.content.size - 1)
    const parts = text.split('\n')
    parts.forEach((part, i) => {
      if (i > 0) ed.commands.splitBlock()
      if (!part) return
      const { from } = ed.state.selection
      const prev = from > 1 ? ed.state.doc.textBetween(from - 1, from, '\n', '\n') : ''
      const needSpace = prev && !/[\s\n(]/.test(prev) && !/^[.,?!:;)]/.test(part)
      ed.commands.insertContent({ type: 'text', text: (needSpace ? ' ' : '') + part })
    })
    ed.commands.scrollIntoView()
  }

  // ---------- note actions ----------
  function setPaper(p: Paper) {
    paperOpen = false
    store.updateNote(id, { paper: p })
  }

  async function remove() {
    menuOpen = false
    const ok = !settings.confirmDelete || (await confirmDialog('למחוק את ההערה?', 'אפשר לשחזר אותה מסל המחזור במשך 30 יום.', 'מחיקה', true))
    if (!ok) return
    await store.trashNote(id)
    store.say('ההערה הועברה לסל המחזור')
    store.back()
  }

  function onTitle(e: Event) {
    store.updateNote(id, { title: (e.target as HTMLInputElement).value })
  }
</script>

<div class="screen" style="--ed-font:{fontStack(settings.editorFont)}; --ed-size:{settings.editorSize}px; --ed-lh:{settings.lineHeight}; --lh:{lh}px; --pad:{pad}px; --lh-offset:{18 + (settings.showTitle ? 0 : 0)}px">
  <header class="topbar ed-top">
    <button class="icon-btn" aria-label="חזרה" onclick={() => store.back()}><Icon name="back" /></button>
    <div class="spacer"></div>
    <button class="icon-btn" aria-label="ביטול" disabled={!canUndo()} onclick={() => chain().undo().run()}><Icon name="undo" /></button>
    <button class="icon-btn" aria-label="ביצוע מחדש" disabled={!canRedo()} onclick={() => chain().redo().run()}><Icon name="redo" /></button>
    <button class="icon-btn" class:on={fmtVisible} aria-label="עיצוב טקסט" onclick={() => (fmtVisible = !fmtVisible)}><Icon name="type" /></button>
    <button class="icon-btn" aria-label="אפשרויות" onclick={() => (menuOpen = true)}><Icon name="more" /></button>
  </header>

  {#snippet toolbar()}
    <div class="fmt" role="toolbar" aria-label="עיצוב">
      <button class="tb font-btn" onclick={() => (fontOpen = true)} style="font-family:{fontStack(currentFont())}">
        {fontLabel(currentFont())}
      </button>
      <div class="size">
        <button class="tb" aria-label="הקטנה" onclick={() => size(-1)}><Icon name="minus" size={18} /></button>
        <span class="size-v">{currentSize()}</span>
        <button class="tb" aria-label="הגדלה" onclick={() => size(1)}><Icon name="plus" size={18} /></button>
      </div>
      <span class="div"></span>
      <button class="tb" class:on={is('bold')} aria-label="מודגש" onclick={() => chain().toggleBold().run()}><Icon name="bold" size={19} stroke={2.3} /></button>
      <button class="tb" class:on={is('italic')} aria-label="נטוי" onclick={() => chain().toggleItalic().run()}><Icon name="italic" size={19} /></button>
      <button class="tb" class:on={is('underline')} aria-label="קו תחתון" onclick={() => chain().toggleUnderline().run()}><Icon name="underline" size={19} /></button>
      <button class="tb" class:on={is('highlight')} aria-label="צבע וסימון" onclick={() => (colorOpen = true)}><Icon name="highlight" size={19} /></button>
      <span class="div"></span>
      <button class="tb" class:on={is('heading')} aria-label="כותרת" onclick={() => (headOpen = true)}><Icon name="h" size={19} /></button>
      <button class="tb" aria-label="יישור" onclick={() => (alignOpen = true)}><Icon name={alignIcon()} size={19} /></button>
      <button class="tb" class:on={is('bulletList')} aria-label="רשימה" onclick={() => chain().toggleBulletList().run()}><Icon name="list" size={19} /></button>
      <button class="tb" class:on={is('orderedList')} aria-label="רשימה ממוספרת" onclick={() => chain().toggleOrderedList().run()}><Icon name="listOrdered" size={19} /></button>
      <button class="tb" class:on={is('taskList')} aria-label="משימות" onclick={() => chain().toggleTaskList().run()}><Icon name="checklist" size={19} /></button>
      <span class="div"></span>
      <button class="tb" class:on={is('blockquote')} aria-label="ציטוט" onclick={() => chain().toggleBlockquote().run()}><Icon name="quote" size={19} /></button>
      <button class="tb" class:on={is('strike')} aria-label="קו חוצה" onclick={() => chain().toggleStrike().run()}><Icon name="strike" size={19} /></button>
      <button class="tb" aria-label="קו מפריד" onclick={() => chain().setHorizontalRule().run()}><Icon name="rule" size={19} /></button>
      <button class="tb" aria-label="ניקוי עיצוב" onclick={() => chain().unsetAllMarks().clearNodes().run()}><Icon name="eraser" size={19} /></button>
    </div>
  {/snippet}

  {#if fmtVisible && settings.toolbarPosition === 'top'}{@render toolbar()}{/if}

  <div class="scroll page paper-{paper}" style="padding-inline:{pad}px">
    {#if settings.showTitle}
      <input class="title-in" placeholder="כותרת" value={note?.title ?? ''} oninput={onTitle} enterkeyhint="next"
        onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); editor?.commands.focus('start') } }} />
    {/if}
    <div class="ed" bind:this={el}></div>
    <div class="tail" role="presentation" onclick={() => editor?.commands.focus('end')}></div>
  </div>

  {#if fmtVisible && settings.toolbarPosition === 'bottom'}{@render toolbar()}{/if}

  <LongRecBar noteId={id} />
  <DictationBar onmic={toggleMic} {words} />
</div>

<Sheet bind:open={fontOpen} title="גופן">
  {#each allFontChoices() as f (f.family)}
    <button class="font-row" class:sel={currentFont() === f.family} style="font-family:{fontStack(f.family)}" onclick={() => setFont(f.family)}>
      <span>{f.label}</span><span class="sample">אבג דהו · Abc</span>
    </button>
  {/each}
  <MenuItem icon="font" label="הוספת גופן…" hint="מקובץ או מהגופנים של המכשיר" onclick={() => { fontOpen = false; store.go({ name: 'settings', section: 'fonts' }) }} />
</Sheet>

<Sheet bind:open={headOpen} title="סגנון">
  <MenuItem label="טקסט רגיל" selected={is('paragraph')} onclick={() => { headOpen = false; chain().setParagraph().run() }} />
  <MenuItem label="כותרת גדולה" selected={is('heading', { level: 1 })} onclick={() => { headOpen = false; chain().setHeading({ level: 1 }).run() }} />
  <MenuItem label="כותרת בינונית" selected={is('heading', { level: 2 })} onclick={() => { headOpen = false; chain().setHeading({ level: 2 }).run() }} />
  <MenuItem label="כותרת קטנה" selected={is('heading', { level: 3 })} onclick={() => { headOpen = false; chain().setHeading({ level: 3 }).run() }} />
</Sheet>

<Sheet bind:open={alignOpen} title="יישור">
  <MenuItem icon="alignRight" label="לימין" onclick={() => { alignOpen = false; chain().setTextAlign('right').run() }} />
  <MenuItem icon="alignCenter" label="למרכז" onclick={() => { alignOpen = false; chain().setTextAlign('center').run() }} />
  <MenuItem icon="alignLeft" label="לשמאל" onclick={() => { alignOpen = false; chain().setTextAlign('left').run() }} />
  <MenuItem icon="alignJustify" label="מיושר לשני הצדדים" onclick={() => { alignOpen = false; chain().setTextAlign('justify').run() }} />
</Sheet>

<Sheet bind:open={colorOpen} title="צבע טקסט">
  <div class="swatches">
    {#each TEXT_COLORS as c (c.n)}
      <button class="sw" aria-label={c.n} style="--c:{c.c || 'var(--text)'}" onclick={() => { colorOpen = false; c.c ? chain().setColor(c.c).run() : chain().unsetColor().run() }}><span>א</span></button>
    {/each}
  </div>
  <div class="section-label">סימון רקע</div>
  <div class="swatches">
    {#each MARKS as m (m.n)}
      <button class="sw mark" aria-label={m.n} style="--c:{m.c}" onclick={() => { colorOpen = false; chain().setHighlight({ color: m.c }).run() }}></button>
    {/each}
    <button class="sw none" aria-label="בלי סימון" onclick={() => { colorOpen = false; chain().unsetHighlight().run() }}><Icon name="close" size={18} /></button>
  </div>
</Sheet>

<Sheet bind:open={paperOpen} title="סוג דף">
  <MenuItem icon="blank" label="נקי" selected={paper === 'plain'} onclick={() => setPaper('plain')} />
  <MenuItem icon="lines" label="שורות (מחברת)" selected={paper === 'lined'} onclick={() => setPaper('lined')} />
  <MenuItem icon="grid" label="משבצות" selected={paper === 'grid'} onclick={() => setPaper('grid')} />
  <MenuItem icon="dots" label="נקודות" selected={paper === 'dots'} onclick={() => setPaper('dots')} />
</Sheet>

<Sheet bind:open={menuOpen}>
  {#if isNative && !jobs.recording}
    <MenuItem icon="wave" label="הקלטה ארוכה" hint="מדברים כמה שרוצים, והתמלול נעשה ברקע, לאט ובדיוק" onclick={() => { menuOpen = false; startLong() }} />
  {/if}
  <MenuItem icon="sparkle" label="סידור הטקסט" hint="פיסוק, פסקאות, כותרות ורשימות" onclick={() => { menuOpen = false; tidyOpen = true }} />
  <MenuItem icon="lines" label="סוג דף" hint="נקי, שורות, משבצות או נקודות" onclick={() => { menuOpen = false; paperOpen = true }} />
  <MenuItem icon="pin" label={note?.pinned ? 'ביטול הצמדה' : 'הצמדה למעלה'} onclick={() => { menuOpen = false; store.togglePin(id) }} />
  <MenuItem icon="move" label="העברה לתיקייה" onclick={() => { menuOpen = false; pickOpen = true }} />
  <MenuItem icon="share" label="שיתוף כטקסט" onclick={() => { menuOpen = false; note && shareText(note) }} />
  <MenuItem icon="pdf" label="ייצוא ל־PDF ושיתוף" onclick={() => { menuOpen = false; store.flushSaves(); note && exportPdf(note) }} />
  <MenuItem icon="copy" label="העתקת כל הטקסט" onclick={() => { menuOpen = false; note && copyText(note) }} />
  <MenuItem icon="info" label="פרטי ההערה" onclick={() => { menuOpen = false; infoOpen = true }} />
  <MenuItem icon="trash" label="מחיקה" danger onclick={remove} />
</Sheet>

<Sheet bind:open={infoOpen} title="פרטי ההערה">
  {#if note}
    <div class="info">
      <div><span>מילים</span><b>{words}</b></div>
      <div><span>תווים</span><b>{chars()}</b></div>
      <div><span>נוצרה</span><b>{new Date(note.created).toLocaleString('he-IL')}</b></div>
      <div><span>עודכנה</span><b>{formatDate(note.updated)}</b></div>
      <div><span>תיקייה</span><b>{store.folder(note.folderId)?.name ?? 'ראשי'}</b></div>
    </div>
  {/if}
</Sheet>

<FolderPicker bind:open={pickOpen} current={note?.folderId ?? null} onpick={(f) => { store.moveNote(id, f); store.say('ההערה הועברה') }} />

<TidySheet bind:open={tidyOpen} source={tidyOpen ? noteText() : ''} onapply={applyTidy} />

<style>
  .ed-top { min-height: 54px; }
  .page { background-color: var(--surface); padding-top: 18px; }
  :global([data-theme='eink']) .page { background-color: #fff; }
  .title-in {
    width: 100%; border: none; outline: none; background: transparent;
    font-family: var(--ed-font); font-size: calc(var(--ed-size) * 1.45); font-weight: 700;
    line-height: var(--lh); height: var(--lh); padding: 0; margin: 0 0 0;
  }
  .title-in::placeholder { color: var(--faint); font-weight: 600; }
  .ed :global(.prose) {
    font-family: var(--ed-font); font-size: var(--ed-size); line-height: var(--ed-lh);
    min-height: 40vh; padding-bottom: 20px;
  }
  .tail { min-height: 45vh; cursor: text; }

  .fmt {
    display: flex; align-items: center; gap: 2px; overflow-x: auto; scrollbar-width: none;
    padding: 6px 8px; background: var(--bg); border-bottom: 1px solid var(--line);
    flex: none;
  }
  .fmt::-webkit-scrollbar { display: none; }
  :global([data-theme='eink']) .fmt { border-bottom: 1.5px solid #000; }
  .tb {
    flex: none; min-width: 40px; height: 40px; display: grid; place-items: center;
    border-radius: 10px; color: var(--text); transition: background var(--speed);
  }
  .tb:active { background: var(--surface-3); }
  .tb.on { background: var(--accent-soft); color: var(--accent-text); }
  :global([data-theme='eink']) .tb.on { background: #000; color: #fff; }
  .font-btn { padding: 0 12px; font-size: 0.98rem; font-weight: 600; max-width: 130px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: var(--surface-2); }
  .size { display: flex; align-items: center; background: var(--surface-2); border-radius: 10px; margin-inline-start: 4px; }
  .size .tb { min-width: 34px; }
  .size-v { min-width: 26px; text-align: center; font-weight: 700; font-variant-numeric: tabular-nums; font-size: 0.95rem; }
  .div { width: 1px; height: 24px; background: var(--line); margin: 0 5px; flex: none; }

  .font-row { width: 100%; display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 12px 22px; font-size: 1.15rem; text-align: start; }
  .font-row:active { background: var(--surface-2); }
  .font-row.sel { color: var(--accent-text); font-weight: 700; }
  .sample { color: var(--muted); font-size: 1rem; }

  .swatches { display: flex; flex-wrap: wrap; gap: 12px; padding: 8px 22px 14px; }
  .sw { width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center; border: 1.5px solid var(--line); color: var(--c); font-weight: 800; font-size: 1.3rem; background: var(--surface); }
  .sw.mark { background: var(--c); }
  .sw.none { color: var(--muted); }

  .info { padding: 4px 22px 12px; }
  .info div { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--line); }
  .info span { color: var(--muted); }
</style>
