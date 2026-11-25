<script lang="ts">
  import Icon from './Icon.svelte'
  import Logo from './Logo.svelte'
  import Sheet from './Sheet.svelte'
  import MenuItem from './MenuItem.svelte'
  import FolderPicker from './FolderPicker.svelte'
  import { confirmDialog, promptDialog } from './Dialog.svelte'
  import { store, displayTitle, previewText, formatDate } from '../lib/store.svelte'
  import { settings, saveSettings } from '../lib/settings.svelte'
  import { exportPdf, shareText } from '../lib/exporter'
  import type { Folder, Note, Paper } from '../lib/types'

  let { folderId }: { folderId: string | null } = $props()

  const folder = $derived(store.folder(folderId))
  const crumbs = $derived(store.path(folderId))
  const folders = $derived(store.childFolders(folderId))
  const notes = $derived(store.notesIn(folderId))

  let newOpen = $state(false)
  let menuOpen = $state(false)
  let itemNote: Note | null = $state(null)
  let itemFolder: Folder | null = $state(null)
  let itemOpen = $state(false)
  let pickOpen = $state(false)
  let sortOpen = $state(false)

  function openFolder(f: Folder) {
    store.go({ name: 'library', folderId: f.id })
  }

  async function newNote(paper: Paper | 'tasks', dictate = false) {
    newOpen = false
    const html = paper === 'tasks' ? '<ul data-type="taskList"><li data-checked="false"><p></p></li></ul>' : ''
    const n = await store.createNote(folderId, html)
    const p: Paper = paper === 'tasks' ? 'plain' : paper
    if (p !== 'plain') store.updateNote(n.id, { paper: p })
    store.go({ name: 'note', id: n.id, dictate })
  }

  async function newFolder() {
    newOpen = false
    const name = await promptDialog(folderId ? 'תיקייה חדשה בתוך ' + folder?.name : 'תיקייה חדשה', '', 'למשל: שיעורים', 'יצירה')
    if (name?.trim()) await store.createFolder(name, folderId)
  }

  function longNote(n: Note, e?: Event) {
    e?.preventDefault()
    itemNote = n
    itemFolder = null
    itemOpen = true
  }

  function longFolder(f: Folder, e?: Event) {
    e?.preventDefault()
    itemFolder = f
    itemNote = null
    itemOpen = true
  }

  async function renameFolder(f: Folder) {
    itemOpen = false
    const name = await promptDialog('שינוי שם', f.name)
    if (name?.trim()) await store.renameFolder(f.id, name)
  }

  async function deleteFolder(f: Folder) {
    itemOpen = false
    const count = store.countIn(f.id)
    const ok =
      !settings.confirmDelete ||
      (await confirmDialog(`למחוק את "${f.name}"?`, count ? `התיקייה וכל ${count} ההערות שבה יעברו לסל המחזור.` : 'התיקייה תעבור לסל המחזור.', 'מחיקה', true))
    if (ok) {
      await store.trashFolder(f.id)
      store.say('הועבר לסל המחזור')
    }
  }

  async function deleteNote(n: Note) {
    itemOpen = false
    const ok = !settings.confirmDelete || (await confirmDialog('למחוק את ההערה?', 'אפשר לשחזר אותה מסל המחזור במשך 30 יום.', 'מחיקה', true))
    if (ok) {
      await store.trashNote(n.id)
      store.say('ההערה הועברה לסל המחזור')
    }
  }

  function startMove() {
    itemOpen = false
    pickOpen = true
  }

  async function moved(target: string | null) {
    if (itemNote) await store.moveNote(itemNote.id, target)
    if (itemFolder) await store.moveFolder(itemFolder.id, target)
    store.say('הועבר')
  }

  function setSort(by: 'updated' | 'created' | 'title') {
    settings.sortBy = by
    saveSettings()
    sortOpen = false
  }

  function paperIcon(n: Note) {
    if (n.html.includes('data-type="taskList"')) return 'checklist'
    return 'note'
  }
</script>

<div class="screen">
  <header class="topbar">
    {#if folderId}
      <button class="icon-btn" aria-label="חזרה" onclick={() => store.back()}><Icon name="back" /></button>
      <div class="title">{folder?.name}</div>
    {:else}
      <div class="brand">
        <Logo size={36} mono={settings.theme === 'eink'} />
        <span class="brand-name">פתקול</span>
      </div>
      <div class="spacer"></div>
    {/if}
    <button class="icon-btn" aria-label="חיפוש" onclick={() => store.go({ name: 'search' })}><Icon name="search" /></button>
    <button class="icon-btn" aria-label="תפריט" onclick={() => (menuOpen = true)}><Icon name="more" /></button>
  </header>

  {#if crumbs.length > 1}
    <nav class="crumbs" aria-label="מיקום">
      <button onclick={() => store.replace({ name: 'library', folderId: null })}>ראשי</button>
      {#each crumbs as c, i (c.id)}
        <span class="sep">‹</span>
        {#if i < crumbs.length - 1}
          <button onclick={() => store.replace({ name: 'library', folderId: c.id })}>{c.name}</button>
        {:else}
          <span class="here">{c.name}</span>
        {/if}
      {/each}
    </nav>
  {/if}

  <div class="scroll" class:compact={settings.density === 'compact'}>
    {#if folders.length}
      <div class="section-label">תיקיות</div>
      <div class="folders">
        {#each folders as f (f.id)}
          <button class="folder" onclick={() => openFolder(f)} oncontextmenu={(e) => longFolder(f, e)}>
            <span class="f-ic"><Icon name="folder" size={24} /></span>
            <span class="f-name">{f.name}</span>
            <span class="f-count">{store.countIn(f.id) || ''}</span>
          </button>
        {/each}
      </div>
    {/if}

    {#if notes.length}
      <div class="section-label notes-label">
        <span>הערות</span>
        <button class="sort" onclick={() => (sortOpen = true)}>
          <Icon name="sort" size={15} />
          {settings.sortBy === 'title' ? 'לפי שם' : settings.sortBy === 'created' ? 'לפי יצירה' : 'לפי עדכון'}
        </button>
      </div>
      <div class="notes">
        {#each notes as n (n.id)}
          <div class="note-row">
            <button class="note" onclick={() => store.go({ name: 'note', id: n.id })} oncontextmenu={(e) => longNote(n, e)}>
              <div class="n-head">
                {#if n.pinned}<span class="pin"><Icon name="pin" size={15} /></span>{/if}
                {#if paperIcon(n) === 'checklist'}<span class="kind"><Icon name="checklist" size={16} /></span>{/if}
                <span class="n-title">{displayTitle(n)}</span>
              </div>
              {#if settings.previewLines > 0 && previewText(n)}
                <div class="n-prev" style="-webkit-line-clamp:{settings.previewLines}">{previewText(n)}</div>
              {/if}
              {#if settings.showDates}<div class="n-date">{formatDate(n.updated)}</div>{/if}
            </button>
            <button class="row-more" aria-label="אפשרויות" onclick={() => longNote(n)}><Icon name="more" size={19} /></button>
          </div>
        {/each}
      </div>
    {/if}

    {#if !folders.length && !notes.length}
      <div class="empty">
        <div class="empty-art"><Logo size={72} mono={settings.theme === 'eink'} /></div>
        <div class="empty-t">{folderId ? 'התיקייה ריקה' : 'עוד אין כאן הערות'}</div>
        <div class="empty-s">לחצו על <b>הכתבה</b> ודברו, או על <b>חדש</b> כדי לכתוב.</div>
      </div>
    {/if}
    <div style="height:120px"></div>
  </div>

  <div class="dock">
    <button class="dock-new" onclick={() => (newOpen = true)}>
      <Icon name="plus" size={22} stroke={2.2} /> <span>חדש</span>
    </button>
    <button class="dock-mic" onclick={() => newNote(settings.defaultPaper, true)} aria-label="הערה חדשה בהכתבה">
      <Icon name="mic" size={26} stroke={2.1} /> <span>הכתבה</span>
    </button>
  </div>
</div>

<Sheet bind:open={newOpen} title="מה ליצור?">
  <MenuItem icon="note" label="הערה רגילה" hint="דף נקי, כותבים חופשי" onclick={() => newNote('plain')} />
  <MenuItem icon="lines" label="דף מחברת" hint="עם שורות, כמו מחברת" onclick={() => newNote('lined')} />
  <MenuItem icon="checklist" label="רשימת משימות" hint="משימות עם וי" onclick={() => newNote('tasks')} />
  <MenuItem icon="grid" label="דף משבצות" onclick={() => newNote('grid')} />
  <MenuItem icon="mic" label="הערה בהכתבה" hint="פותח הערה ומתחיל להקשיב" onclick={() => newNote(settings.defaultPaper, true)} />
  <MenuItem icon="folderPlus" label="תיקייה חדשה" hint={folderId ? 'בתוך ' + folder?.name : ''} onclick={newFolder} />
</Sheet>

<Sheet bind:open={menuOpen}>
  <MenuItem icon="folderPlus" label="תיקייה חדשה" onclick={() => { menuOpen = false; newFolder() }} />
  {#if folder}
    <MenuItem icon="edit" label="שינוי שם התיקייה" onclick={() => { menuOpen = false; renameFolder(folder) }} />
  {/if}
  <MenuItem icon="sort" label="מיון הערות" onclick={() => { menuOpen = false; sortOpen = true }} />
  <MenuItem icon="trash" label="סל המחזור" onclick={() => { menuOpen = false; store.go({ name: 'trash' }) }} />
  {#if store.hasLock}
    <MenuItem icon="lock" label="נעילה עכשיו" onclick={() => { menuOpen = false; store.lock() }} />
  {/if}
  <MenuItem icon="settings" label="הגדרות" onclick={() => { menuOpen = false; store.go({ name: 'settings' }) }} />
  <MenuItem icon="help" label="מדריך קצר" onclick={() => { menuOpen = false; store.go({ name: 'help' }) }} />
  <MenuItem icon="heart" label="אודות והודות" onclick={() => { menuOpen = false; store.go({ name: 'about' }) }} />
</Sheet>

<Sheet bind:open={sortOpen} title="מיון הערות">
  <MenuItem label="לפי עדכון אחרון" selected={settings.sortBy === 'updated'} onclick={() => setSort('updated')} />
  <MenuItem label="לפי תאריך יצירה" selected={settings.sortBy === 'created'} onclick={() => setSort('created')} />
  <MenuItem label="לפי שם" selected={settings.sortBy === 'title'} onclick={() => setSort('title')} />
</Sheet>

<Sheet bind:open={itemOpen} title={itemNote ? displayTitle(itemNote) : itemFolder?.name}>
  {#if itemNote}
    {@const n = itemNote}
    <MenuItem icon="pin" label={n.pinned ? 'ביטול הצמדה' : 'הצמדה למעלה'} onclick={() => { itemOpen = false; store.togglePin(n.id) }} />
    <MenuItem icon="move" label="העברה לתיקייה" onclick={startMove} />
    <MenuItem icon="share" label="שיתוף כטקסט" onclick={() => { itemOpen = false; shareText(n) }} />
    <MenuItem icon="pdf" label="ייצוא ל־PDF" onclick={() => { itemOpen = false; exportPdf(n) }} />
    <MenuItem icon="trash" label="מחיקה" danger onclick={() => deleteNote(n)} />
  {:else if itemFolder}
    {@const f = itemFolder}
    <MenuItem icon="edit" label="שינוי שם" onclick={() => renameFolder(f)} />
    <MenuItem icon="move" label="העברה לתיקייה אחרת" onclick={startMove} />
    <MenuItem icon="trash" label="מחיקה" danger onclick={() => deleteFolder(f)} />
  {/if}
</Sheet>

<FolderPicker
  bind:open={pickOpen}
  exclude={itemFolder?.id ?? null}
  current={itemNote?.folderId ?? itemFolder?.parentId ?? null}
  onpick={moved}
/>

<style>
  .brand { display: flex; align-items: center; gap: 10px; padding: 0 8px; }
  .brand-name { font-family: var(--font-display); font-size: 1.7rem; font-weight: 700; letter-spacing: -0.01em; }

  .crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; padding: 0 20px 6px; font-size: 0.88rem; color: var(--muted); }
  .crumbs button { color: var(--muted); padding: 4px 2px; }
  .crumbs .here { color: var(--text); font-weight: 600; }
  .sep { color: var(--faint); }

  .folders { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; padding: 0 16px; }
  .folder {
    display: flex; align-items: center; gap: 10px; min-height: 58px; padding: 10px 14px;
    background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
    text-align: start; transition: transform var(--speed), background var(--speed);
  }
  .folder:active { transform: scale(0.98); background: var(--surface-2); }
  :global([data-theme='eink']) .folder { border: 1.5px solid #000; }
  .f-ic { color: var(--accent); display: grid; }
  .f-name { flex: 1; min-width: 0; font-weight: 600; font-size: 1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .f-count { font-size: 0.82rem; color: var(--faint); font-variant-numeric: tabular-nums; }

  .notes-label { display: flex; align-items: center; justify-content: space-between; }
  .sort { display: inline-flex; align-items: center; gap: 4px; font-size: 0.8rem; font-weight: 600; color: var(--muted); padding: 4px 6px; }

  .notes { display: flex; flex-direction: column; gap: 10px; padding: 0 16px; }
  .note-row { position: relative; }
  .note {
    width: 100%; display: block; text-align: start; padding: 14px 18px 12px; padding-inline-end: 44px;
    background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-lg);
    box-shadow: var(--shadow); transition: transform var(--speed);
  }
  .note:active { transform: scale(0.99); }
  :global([data-theme='eink']) .note { border: 1.5px solid #000; }
  .compact .note { padding: 10px 16px 9px; padding-inline-end: 44px; border-radius: var(--radius); }
  .compact .notes { gap: 6px; }
  .row-more { position: absolute; top: 8px; inset-inline-end: 4px; width: 40px; height: 40px; display: grid; place-items: center; color: var(--faint); border-radius: 50%; }
  .n-head { display: flex; align-items: center; gap: 6px; }
  .pin, .kind { color: var(--accent); display: grid; }
  .n-title { font-weight: 700; font-size: 1.07rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .n-prev {
    margin-top: 3px; color: var(--muted); font-size: 0.95rem; line-height: 1.45;
    display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden;
  }
  .n-date { margin-top: 6px; font-size: 0.78rem; color: var(--faint); }

  .empty { text-align: center; padding: 70px 30px 20px; }
  .empty-art { display: grid; place-items: center; margin-bottom: 18px; opacity: 0.9; }
  .empty-t { font-family: var(--font-display); font-size: 1.35rem; font-weight: 700; }
  .empty-s { color: var(--muted); margin-top: 6px; }

  .dock {
    position: fixed; inset-inline: 0; bottom: 0; z-index: 10;
    display: flex; justify-content: center; gap: 12px;
    padding: 14px 16px calc(var(--safe-bottom) + 16px);
    background: linear-gradient(to top, var(--bg) 60%, transparent);
  }
  :global([data-theme='eink']) .dock { background: #fff; border-top: 1.5px solid #000; }
  .dock button {
    display: inline-flex; align-items: center; gap: 8px; height: 56px; padding: 0 24px;
    border-radius: 999px; font-weight: 700; font-size: 1.05rem; box-shadow: var(--shadow);
    transition: transform var(--speed);
  }
  .dock button:active { transform: scale(0.96); }
  .dock-new { background: var(--surface); border: 1px solid var(--line); color: var(--text); }
  .dock-mic { background: var(--accent); color: var(--accent-ink); }
  :global([data-theme='eink']) .dock-new { border: 2px solid #000; box-shadow: none; }
  :global([data-theme='eink']) .dock-mic { background: #000; color: #fff; box-shadow: none; }
</style>
