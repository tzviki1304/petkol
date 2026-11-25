<script lang="ts">
  import Sheet from './Sheet.svelte'
  import Icon from './Icon.svelte'
  import { tidyText, defaultTidy, LAYOUTS, type TidyOptions } from '../lib/tidy'

  let {
    open = $bindable(false),
    source = null,
    onapply,
  }: {
    open?: boolean
    /** text of the current note; null = paste mode (creates a new note) */
    source?: string | null
    onapply: (html: string) => void
  } = $props()

  let text = $state('')
  let opts: TidyOptions = $state({ ...defaultTidy, emphasis: true, style: 'none' })
  let preview = $state(false)

  const input = $derived(source ?? text)
  const result = $derived(preview ? tidyText(input, opts) : null)

  const CHIPS: { k: Exclude<keyof TidyOptions, 'style'>; label: string }[] = [
    { k: 'punctuation', label: 'פיסוק' },
    { k: 'paragraphs', label: 'פסקאות' },
    { k: 'structure', label: 'כותרות ורשימות' },
    { k: 'emphasis', label: 'הדגשות חכמות' },
    { k: 'fillers', label: 'הסרת "אממ" וחזרות' },
    { k: 'typography', label: 'גרשיים ומקפים' },
  ]

  $effect(() => {
    if (!open) {
      preview = false
      text = ''
    }
  })

  function apply() {
    const r = tidyText(input, opts)
    if (!r.html) return
    open = false
    onapply(r.html)
  }

  async function paste() {
    try {
      text = await navigator.clipboard.readText()
    } catch {}
  }
</script>

<Sheet bind:open title={source === null ? 'סידור טקסט' : 'עימוד וסידור ההערה'}>
  <div class="tidy">
    {#if source === null}
      <p class="hint">מדביקים טקסט (למשל מתמלול, מוואטסאפ או ממסמך), והוא יסודר לקריאה נוחה.</p>
      <div class="ta-wrap">
        <textarea class="field ta" bind:value={text} placeholder="הדביקו כאן את הטקסט…" dir="rtl"></textarea>
        {#if !text}<button class="paste" onclick={paste}><Icon name="copy" size={17} /> הדבקה</button>{/if}
      </div>
    {:else}
      <p class="hint">ההערה תסודר מחדש: פיסוק, פסקאות, כותרות, הדגשות וגופנים. לא אהבתם? כפתור "ביטול" למעלה מחזיר אותה כמו שהייתה.</p>
    {/if}

    <div class="chips">
      {#each CHIPS as c (c.k)}
        <button class="chip" class:on={opts[c.k]} onclick={() => (opts[c.k] = !opts[c.k])}>
          {#if opts[c.k]}<Icon name="check" size={15} stroke={2.6} />{/if}{c.label}
        </button>
      {/each}
    </div>

    <div class="styles" role="radiogroup" aria-label="סגנון עימוד">
      {#each LAYOUTS as l (l.id)}
        <button class="st st-{l.id}" class:sel={opts.style === l.id} role="radio" aria-checked={opts.style === l.id} onclick={() => (opts.style = l.id)}>
          <span class="st-a">אב</span><span class="st-l">{l.label}</span>
        </button>
      {/each}
    </div>

    {#if result}
      <div class="preview prose">{@html result.html}</div>
    {/if}

    <div class="actions">
      <button class="btn" disabled={!input.trim()} onclick={() => (preview = !preview)}>{preview ? 'הסתרת תצוגה' : 'תצוגה מקדימה'}</button>
      <button class="btn primary" disabled={!input.trim()} onclick={apply}>
        <Icon name="sparkle" size={18} /> {source === null ? 'סידור ויצירת הערה' : 'סידור'}
      </button>
    </div>
  </div>
</Sheet>

<style>
  .tidy { padding: 0 18px 8px; }
  .hint { margin: 0 4px 10px; color: var(--muted); font-size: 0.9rem; }
  .ta-wrap { position: relative; }
  .ta { min-height: 150px; max-height: 34vh; resize: none; line-height: 1.6; }
  .paste { position: absolute; top: 10px; inset-inline-end: 10px; display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px; border-radius: 99px; background: var(--surface-2); font-size: 0.85rem; font-weight: 600; }
  .chips { display: flex; flex-wrap: wrap; gap: 7px; margin: 12px 0 4px; }
  .chip { display: inline-flex; align-items: center; gap: 4px; padding: 6px 12px; border-radius: 99px; border: 1.5px solid var(--line-strong); font-size: 0.86rem; font-weight: 600; color: var(--muted); }
  .chip.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-text); }
  :global([data-theme='eink']) .chip.on { background: #000; color: #fff; border-color: #000; }
  .styles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 10px; }
  .st { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 4px; border-radius: var(--radius-sm); border: 1.5px solid var(--line); }
  .st.sel { border-color: var(--accent); background: var(--accent-soft); }
  :global([data-theme='eink']) .st.sel { border-width: 3px; border-color: #000; background: #fff; }
  .st-a { font-size: 1.35rem; line-height: 1.2; }
  .st-l { font-size: 0.78rem; font-weight: 600; color: var(--muted); }
  .st-modern .st-a { font-family: 'Rubik', sans-serif; font-weight: 700; }
  .st-classic .st-a { font-family: 'Suez One', serif; }
  .st-book .st-a { font-family: 'David Libre', serif; }
  .preview { margin-top: 12px; max-height: 30vh; overflow-y: auto; padding: 12px 14px; border-radius: var(--radius); background: var(--surface-2); font-size: 0.98rem; line-height: 1.65; }
  .preview :global(h3) { font-size: 1.05rem; margin: 0.3em 0; }
  .preview :global(p) { margin: 0 0 0.6em; }
  .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
</style>
