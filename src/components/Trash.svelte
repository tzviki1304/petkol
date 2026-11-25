<script lang="ts">
  import Icon from './Icon.svelte'
  import { confirmDialog } from './Dialog.svelte'
  import { store, displayTitle, formatDate } from '../lib/store.svelte'

  const t = $derived(store.trashed())

  async function empty() {
    if (await confirmDialog('לרוקן את סל המחזור?', 'כל מה שבסל יימחק לצמיתות, ואי אפשר יהיה לשחזר אותו.', 'מחיקה לצמיתות', true)) {
      await store.emptyTrash()
      store.say('סל המחזור רוקן')
    }
  }

  async function forever(kind: 'note' | 'folder', id: string) {
    if (await confirmDialog('למחוק לצמיתות?', 'אי אפשר יהיה לשחזר.', 'מחיקה', true)) await store.deleteForever(kind, id)
  }
</script>

<div class="screen">
  <header class="topbar">
    <button class="icon-btn" aria-label="חזרה" onclick={() => store.back()}><Icon name="back" /></button>
    <div class="title">סל המחזור</div>
    {#if t.notes.length || t.folders.length}<button class="btn ghost danger" onclick={empty}>ריקון</button>{/if}
  </header>
  <div class="scroll">
    <p class="hint muted">פריטים נמחקים מכאן לצמיתות אחרי 30 יום.</p>
    {#each t.folders as f (f.id)}
      <div class="it">
        <Icon name="folder" size={20} />
        <div class="txt"><b>{f.name}</b><span>{formatDate(f.trashed ?? f.updated)}</span></div>
        <button class="icon-btn" aria-label="שחזור" onclick={() => store.restoreFolder(f.id)}><Icon name="restore" size={20} /></button>
        <button class="icon-btn" aria-label="מחיקה לצמיתות" onclick={() => forever('folder', f.id)}><Icon name="trash" size={20} /></button>
      </div>
    {/each}
    {#each t.notes as n (n.id)}
      <div class="it">
        <Icon name="note" size={20} />
        <div class="txt"><b>{displayTitle(n)}</b><span>{formatDate(n.trashed ?? n.updated)}</span></div>
        <button class="icon-btn" aria-label="שחזור" onclick={() => store.restoreNote(n.id)}><Icon name="restore" size={20} /></button>
        <button class="icon-btn" aria-label="מחיקה לצמיתות" onclick={() => forever('note', n.id)}><Icon name="trash" size={20} /></button>
      </div>
    {/each}
    {#if !t.notes.length && !t.folders.length}<p class="empty muted">סל המחזור ריק</p>{/if}
  </div>
</div>

<style>
  .hint { padding: 0 22px; font-size: 0.88rem; }
  .it { display: flex; align-items: center; gap: 12px; margin: 0 14px 8px; padding: 6px 6px 6px 14px; padding-inline-start: 16px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); color: var(--muted); }
  .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; color: var(--text); }
  .txt b { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .txt span { font-size: 0.8rem; color: var(--faint); }
  .empty { text-align: center; padding: 60px 20px; }
  .danger { color: var(--danger); }
</style>
