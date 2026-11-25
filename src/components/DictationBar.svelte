<script lang="ts">
  import Icon from './Icon.svelte'
  import { dictation, engine } from '../lib/speech/engine.svelte'
  import { settings } from '../lib/settings.svelte'

  let { onmic, words = 0 }: { onmic: () => void; words?: number } = $props()

  const loading = $derived(dictation.starting || engine.status[settings.engine] === 'loading')
  const time = $derived(`${Math.floor(dictation.seconds / 60)}:${String(dictation.seconds % 60).padStart(2, '0')}`)
  const bars = [0.5, 0.8, 1, 0.75, 0.45]
</script>

<div class="bar" class:live={dictation.active}>
  {#if dictation.active}
    <div class="status">
      <div class="meter" aria-hidden="true">
        {#each bars as b, i (i)}
          <span style="transform:scaleY({0.18 + Math.min(1, dictation.level * 1.6) * b})"></span>
        {/each}
      </div>
      <div class="st-text">
        <b>{dictation.speaking ? 'מקשיב…' : 'מחכה לדיבור'}</b>
        <span>{time}{dictation.queue > 0 ? ` · מתמלל ${dictation.queue}` : ''}</span>
      </div>
    </div>
  {:else}
    <div class="meta">
      {#if settings.showWordCount}<span>{words} מילים</span>{/if}
      {#if dictation.queue > 0}<span class="busy">מסיים לתמלל…</span>{/if}
    </div>
  {/if}

  <button class="mic" class:on={dictation.active} class:loading onclick={onmic} aria-label={dictation.active ? 'עצירת הכתבה' : 'התחלת הכתבה'} disabled={loading}>
    {#if loading}
      <span class="spin"></span>
    {:else if dictation.active}
      <Icon name="stop" size={26} fill stroke={1.5} />
    {:else}
      <Icon name="mic" size={28} stroke={2.1} />
    {/if}
  </button>

  <div class="side">
    {#if loading}<span class="faint">טוען מודל…</span>
    {:else}<span class="engine">{engine.model(settings.engine).short}</span>{/if}
  </div>
</div>

<style>
  .bar {
    flex: none; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
    gap: 8px; padding: 10px 16px calc(var(--safe-bottom) + 10px);
    background: var(--bg); border-top: 1px solid var(--line);
  }
  :global([data-theme='eink']) .bar { border-top: 1.5px solid #000; }
  .bar.live { background: var(--accent-soft); }
  :global([data-theme='eink']) .bar.live { background: #fff; }
  .meta { display: flex; flex-direction: column; font-size: 0.82rem; color: var(--faint); }
  .busy { color: var(--accent-text); font-weight: 600; }
  .side { display: flex; justify-content: flex-end; font-size: 0.82rem; }
  .engine { color: var(--muted); border: 1px solid var(--line-strong); border-radius: 999px; padding: 2px 10px; }

  .mic {
    width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center;
    background: var(--accent); color: var(--accent-ink); box-shadow: var(--shadow);
    transition: transform var(--speed);
  }
  .mic:active { transform: scale(0.94); }
  .mic.on { background: var(--text); color: var(--bg); }
  :global([data-theme='eink']) .mic { background: #000; color: #fff; box-shadow: none; }
  :global([data-theme='eink']) .mic.on { background: #fff; color: #000; border: 3px solid #000; }
  .spin { width: 24px; height: 24px; border-radius: 50%; border: 3px solid currentColor; border-top-color: transparent; animation: rot 0.9s linear infinite; }
  @keyframes rot { to { transform: rotate(360deg); } }

  .status { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .meter { display: flex; align-items: center; gap: 3px; height: 28px; }
  .meter span { width: 4px; height: 28px; border-radius: 4px; background: var(--accent); transform-origin: center; transition: transform 90ms linear; }
  :global([data-theme='eink']) .meter span { background: #000; }
  .st-text { display: flex; flex-direction: column; line-height: 1.25; font-size: 0.84rem; min-width: 0; }
  .st-text b { font-size: 0.95rem; }
  .st-text span { color: var(--muted); font-variant-numeric: tabular-nums; }
</style>
