<script lang="ts">
  import Logo from './Logo.svelte'
  import Icon from './Icon.svelte'
  import { store } from '../lib/store.svelte'
  import { settings } from '../lib/settings.svelte'

  let pw = $state('')
  let show = $state(false)
  let busy = $state(false)
  let wrong = $state(false)
  let input: HTMLInputElement | undefined = $state()

  $effect(() => {
    input?.focus()
  })

  async function unlock() {
    if (!pw || busy) return
    busy = true
    wrong = false
    const ok = await store.unlock(pw)
    busy = false
    if (!ok) {
      wrong = true
      pw = ''
      input?.focus()
    }
  }
</script>

<div class="lock">
  <div class="inner">
    <Logo size={78} mono={settings.theme === 'eink'} />
    <h1>פתקול</h1>
    <p class="muted">ההערות שלכם נעולות</p>
    <div class="pw" class:wrong>
      <input
        bind:this={input}
        class="field"
        type={show ? 'text' : 'password'}
        placeholder="סיסמה"
        bind:value={pw}
        autocomplete="current-password"
        onkeydown={(e) => e.key === 'Enter' && unlock()}
      />
      <button class="icon-btn eye" aria-label={show ? 'הסתרה' : 'הצגה'} onclick={() => (show = !show)}><Icon name={show ? 'eyeOff' : 'eye'} size={20} /></button>
    </div>
    {#if wrong}<p class="err">הסיסמה לא נכונה, נסו שוב</p>{/if}
    <button class="btn primary block" disabled={!pw || busy} onclick={unlock}>
      <Icon name="unlock" size={19} /> {busy ? 'פותח…' : 'פתיחה'}
    </button>
  </div>
</div>

<style>
  .lock { height: 100%; display: grid; place-items: center; padding: 24px; background: var(--bg); }
  .inner { width: 100%; max-width: 340px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
  h1 { font-family: var(--font-display); font-size: 2rem; margin: 12px 0 0; }
  p { margin: 0 0 18px; }
  .pw { position: relative; width: 100%; margin-bottom: 10px; }
  .pw .field { padding-inline-end: 52px; text-align: center; font-size: 1.15rem; letter-spacing: 0.08em; }
  .eye { position: absolute; inset-inline-end: 4px; top: 2px; }
  .wrong .field { border-color: var(--danger); }
  .err { color: var(--danger); margin: -4px 0 10px; font-size: 0.9rem; }
</style>
