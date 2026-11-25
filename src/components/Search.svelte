<script lang="ts">
  import Icon from './Icon.svelte'
  import { store, displayTitle, formatDate } from '../lib/store.svelte'

  let q = $state('')
  let input: HTMLInputElement | undefined = $state()
  const results = $derived(store.search(q))

  $effect(() => {
    input?.focus()
  })

  function snippet(text: string): string {
    const w = q.trim().split(/\s+/)[0]
    const i = w ? text.indexOf(w) : -1
    if (i < 0) return text.slice(0, 140)
    const s = Math.max(0, i - 50)
    return (s > 0 ? '…' : '') + text.slice(s, s + 150).replace(/\n/g, ' ')
  }
</script>

<div class="screen">
  <header class="topbar">
    <button class="icon-btn" aria-label="חזרה" onclick={() => store.back()}><Icon name="back" /></button>
    <div class="sbox">
      <Icon name="search" size={19} />
      <input bind:this={input} bind:value={q} placeholder="חיפוש בכל ההערות" enterkeyhint="search" />
      {#if q}<button aria-label="ניקוי" onclick={() => (q = '')}><Icon name="close" size={18} /></button>{/if}
    </div>
  </header>
  <div class="scroll">
    {#if q.trim() && !results.length}
      <p class="none muted">לא נמצאו הערות עם "{q}"</p>
    {/if}
    {#each results as n (n.id)}
      <button class="res" onclick={() => store.go({ name: 'note', id: n.id })}>
        <div class="r-t">{displayTitle(n)}</div>
        <div class="r-s">{snippet(n.text)}</div>
        <div class="r-m">{store.folder(n.folderId)?.name ?? 'ראשי'} · {formatDate(n.updated)}</div>
      </button>
    {/each}
  </div>
</div>

<style>
  .sbox { flex: 1; display: flex; align-items: center; gap: 8px; height: 46px; padding: 0 14px; margin-inline-end: 8px; border-radius: 99px; background: var(--surface); border: 1px solid var(--line); color: var(--muted); }
  :global([data-theme='eink']) .sbox { border: 2px solid #000; }
  .sbox input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; font-size: 1.05rem; color: var(--text); }
  .none { text-align: center; padding: 40px; }
  .res { display: block; width: calc(100% - 28px); margin: 0 14px 10px; text-align: start; padding: 12px 16px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); }
  :global([data-theme='eink']) .res { border: 1.5px solid #000; }
  .r-t { font-weight: 700; }
  .r-s { color: var(--muted); font-size: 0.93rem; margin-top: 2px; }
  .r-m { color: var(--faint); font-size: 0.78rem; margin-top: 6px; }
</style>
