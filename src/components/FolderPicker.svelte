<script lang="ts">
  import Sheet from './Sheet.svelte'
  import Icon from './Icon.svelte'
  import { store } from '../lib/store.svelte'
  import type { Folder } from '../lib/types'

  let {
    open = $bindable(false),
    title = 'העברה לתיקייה',
    exclude = null,
    current = null,
    onpick,
  }: { open?: boolean; title?: string; exclude?: string | null; current?: string | null; onpick: (id: string | null) => void } = $props()

  function rows(): { f: Folder; depth: number }[] {
    const out: { f: Folder; depth: number }[] = []
    const walk = (pid: string | null, depth: number) => {
      for (const f of store.childFolders(pid)) {
        if (f.id === exclude) continue
        out.push({ f, depth })
        walk(f.id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }

  function pick(id: string | null) {
    open = false
    onpick(id)
  }
</script>

<Sheet bind:open {title}>
  <button class="r" class:cur={current === null} onclick={() => pick(null)}>
    <Icon name="note" size={20} /> <span>ראשי (בלי תיקייה)</span>
  </button>
  {#each rows() as { f, depth } (f.id)}
    <button class="r" class:cur={current === f.id} style="padding-inline-start:{22 + depth * 22}px" onclick={() => pick(f.id)}>
      <Icon name="folder" size={20} /> <span>{f.name}</span>
    </button>
  {/each}
</Sheet>

<style>
  .r { width: 100%; display: flex; align-items: center; gap: 12px; min-height: 50px; padding: 6px 22px; text-align: start; color: var(--text); }
  .r :global(svg) { color: var(--muted); }
  .r:active { background: var(--surface-2); }
  .cur { font-weight: 700; color: var(--accent-text); }
</style>
