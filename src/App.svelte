<script lang="ts">
  import { onMount } from 'svelte'
  import { App as CapApp } from '@capacitor/app'
  import Library from './components/Library.svelte'
  import Editor from './components/Editor.svelte'
  import Settings from './components/Settings.svelte'
  import Search from './components/Search.svelte'
  import Trash from './components/Trash.svelte'
  import About from './components/About.svelte'
  import Help from './components/Help.svelte'
  import LockScreen from './components/LockScreen.svelte'
  import Dialog, { dialogState } from './components/Dialog.svelte'
  import Logo from './components/Logo.svelte'
  import { store } from './lib/store.svelte'
  import { settings } from './lib/settings.svelte'
  import { fontStack } from './lib/fonts.svelte'
  import { engine, dictation } from './lib/speech/engine.svelte'
  import { updater } from './lib/update.svelte'
  import { isNative } from './lib/native'
  import { StatusBar, Style } from '@capacitor/status-bar'

  let toastTimer: ReturnType<typeof setTimeout> | null = null
  let toastVisible = $state(false)
  let updateBanner = $state(false)

  $effect(() => {
    const root = document.documentElement
    root.dataset.theme = settings.theme
    root.dataset.accent = settings.accent
    root.dataset.anim = settings.animations && settings.theme !== 'eink' ? 'on' : 'off'
    root.style.setProperty('--scale', String(settings.uiScale))
    root.style.setProperty('--font-ui', fontStack(settings.uiFont))
    const meta = document.querySelector('meta[name="theme-color"]') ?? Object.assign(document.createElement('meta'), { name: 'theme-color' })
    if (!meta.parentNode) document.head.appendChild(meta)
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim() || '#f7f5f0'
    meta.setAttribute('content', bg)
    if (isNative) {
      StatusBar.setBackgroundColor({ color: bg }).catch(() => {})
      StatusBar.setStyle({ style: settings.theme === 'dark' ? Style.Dark : Style.Light }).catch(() => {})
    }
  })

  $effect(() => {
    if (store.toast) {
      toastVisible = true
      if (toastTimer) clearTimeout(toastTimer)
      toastTimer = setTimeout(() => (toastVisible = false), 2600)
    }
  })

  onMount(() => {
    store.init()
    engine.init()

    let pausedAt = 0
    if (isNative) {
      CapApp.addListener('backButton', () => {
        if (dialogState.req) {
          dialogState.req.resolve(dialogState.req.input ? null : false)
          dialogState.req = null
          return
        }
        if (document.querySelector('.sheet')) {
          ;(document.querySelector('.scrim') as HTMLElement | null)?.click()
          return
        }
        if (!store.back()) CapApp.minimizeApp()
      })
      CapApp.addListener('pause', () => {
        pausedAt = Date.now()
        store.flushSaves()
        if (store.hasLock && settings.autoLockMin === 0 && !dictation.active) store.lock()
      })
      CapApp.addListener('resume', () => {
        const mins = settings.autoLockMin
        if (store.hasLock && mins > 0 && pausedAt && Date.now() - pausedAt >= mins * 60_000) store.lock()
      })
    }
    window.addEventListener('beforeunload', () => store.flushSaves())

    if (settings.autoCheckUpdates) {
      setTimeout(async () => {
        if (await updater.check(true)) updateBanner = true
      }, 4000)
    }
  })
</script>

{#if !store.ready}
  <div class="splash"><Logo size={72} mono={settings.theme === 'eink'} /></div>
{:else if store.locked}
  <LockScreen />
{:else}
  {@const v = store.view}
  {#key v}
    {#if v.name === 'library'}
      <Library folderId={v.folderId} />
    {:else if v.name === 'note'}
      <Editor id={v.id} dictate={v.dictate} />
    {:else if v.name === 'settings'}
      <Settings section={v.section} />
    {:else if v.name === 'search'}
      <Search />
    {:else if v.name === 'trash'}
      <Trash />
    {:else if v.name === 'about'}
      <About />
    {:else if v.name === 'help'}
      <Help />
    {/if}
  {/key}
{/if}

{#if updateBanner && updater.latest && !store.locked}
  <div class="update card">
    <span>גרסה חדשה של פתקול זמינה ({updater.latest.version})</span>
    <button class="btn primary" onclick={() => { updateBanner = false; store.go({ name: 'settings', section: 'updates' }) }}>לפרטים</button>
    <button class="icon-btn" aria-label="סגירה" onclick={() => (updateBanner = false)}>✕</button>
  </div>
{/if}

{#if toastVisible && store.toast}
  {#key store.toast.id}<div class="toast" role="status">{store.toast.text}</div>{/key}
{/if}

<Dialog />

<style>
  .splash { height: 100%; display: grid; place-items: center; background: var(--bg); }
  .toast {
    position: fixed; bottom: calc(var(--safe-bottom) + 100px); left: 50%; transform: translateX(-50%);
    z-index: 90; max-width: calc(100% - 40px);
    padding: 11px 20px; border-radius: 999px; background: var(--text); color: var(--bg);
    font-weight: 600; font-size: 0.95rem; box-shadow: var(--shadow-lg); animation: rise 200ms ease;
  }
  :global([data-theme='eink']) .toast { background: #fff; color: #000; border: 2px solid #000; }
  .update {
    position: fixed; top: calc(var(--safe-top) + 10px); inset-inline: 12px; z-index: 60;
    display: flex; align-items: center; gap: 10px; padding: 10px 10px 10px 6px; padding-inline-start: 16px;
    font-weight: 600; font-size: 0.93rem; animation: rise 220ms ease;
  }
  .update span { flex: 1; }
</style>
