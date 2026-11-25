<script lang="ts" module>
  // A small promise-based dialog service: ask(), confirm(), prompt().
  interface Req {
    title: string
    message?: string
    input?: { value: string; placeholder?: string; type?: string }
    ok: string
    cancel?: string
    danger?: boolean
    resolve: (v: string | boolean | null) => void
  }
  export const dialogState = $state<{ req: Req | null }>({ req: null })

  export function confirmDialog(title: string, message = '', ok = 'אישור', danger = false): Promise<boolean> {
    return new Promise((resolve) => {
      dialogState.req = { title, message, ok, cancel: 'ביטול', danger, resolve: (v) => resolve(v === true) }
    })
  }

  export function promptDialog(title: string, value = '', placeholder = '', ok = 'שמירה', type = 'text'): Promise<string | null> {
    return new Promise((resolve) => {
      dialogState.req = {
        title,
        input: { value, placeholder, type },
        ok,
        cancel: 'ביטול',
        resolve: (v) => resolve(typeof v === 'string' ? v : null),
      }
    })
  }

  export function alertDialog(title: string, message = ''): Promise<void> {
    return new Promise((resolve) => {
      dialogState.req = { title, message, ok: 'הבנתי', resolve: () => resolve() }
    })
  }
</script>

<script lang="ts">
  let value = $state('')
  let inputEl: HTMLInputElement | undefined = $state()

  $effect(() => {
    const r = dialogState.req
    if (r?.input) {
      value = r.input.value
      queueMicrotask(() => {
        inputEl?.focus()
        inputEl?.select()
      })
    }
  })

  function done(ok: boolean) {
    const r = dialogState.req
    if (!r) return
    dialogState.req = null
    if (!ok) r.resolve(r.input ? null : false)
    else r.resolve(r.input ? value : true)
  }
</script>

{#if dialogState.req}
  {@const r = dialogState.req}
  <div class="scrim" role="presentation" onclick={() => done(false)}></div>
  <div class="dlg card" role="alertdialog" aria-modal="true" aria-label={r.title}>
    <div class="t">{r.title}</div>
    {#if r.message}<div class="m">{r.message}</div>{/if}
    {#if r.input}
      <input
        bind:this={inputEl}
        class="field"
        type={r.input.type ?? 'text'}
        placeholder={r.input.placeholder}
        bind:value
        onkeydown={(e) => e.key === 'Enter' && done(true)}
      />
    {/if}
    <div class="actions">
      {#if r.cancel}<button class="btn ghost" onclick={() => done(false)}>{r.cancel}</button>{/if}
      <button class="btn {r.danger ? 'danger' : 'primary'}" onclick={() => done(true)}>{r.ok}</button>
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; background: var(--scrim); z-index: 80; animation: fade-in var(--speed); }
  .dlg {
    position: fixed; z-index: 81; inset-inline: 20px; top: 26%;
    max-width: 440px; margin: 0 auto; padding: 22px 22px 14px;
    animation: rise 200ms cubic-bezier(.2,.8,.2,1);
  }
  .t { font-family: var(--font-display); font-size: 1.3rem; font-weight: 700; margin-bottom: 6px; }
  .m { color: var(--muted); margin-bottom: 8px; white-space: pre-line; }
  .field { margin: 10px 0 4px; }
  .actions { display: flex; justify-content: flex-start; flex-direction: row-reverse; gap: 6px; margin-top: 14px; }
  .btn.danger { background: var(--danger); color: #fff; }
  :global([data-theme='eink']) .btn.danger { background: #000; }
</style>
