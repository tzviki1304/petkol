<script lang="ts">
  // A slim strip inside the note: shows a long recording, or the calm background transcription of it.
  import Icon from './Icon.svelte'
  import { jobs } from '../lib/speech/jobs.svelte'

  let { noteId }: { noteId: string } = $props()

  const job = $derived(jobs.forNote(noteId))
  const rec = $derived(jobs.recording?.noteId === noteId ? jobs.recording : null)
  const cur = $derived(job && jobs.current?.jobId === job.id ? jobs.current : null)

  function fmt(sec: number) {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = Math.floor(sec % 60)
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0')
  }

  function eta(): string {
    if (!job || !cur || !cur.lastMs) return ''
    const left = job.files.length - job.done
    const min = Math.ceil((left * (cur.lastMs + 1500)) / 60000)
    return min <= 1 ? 'כמעט סיימתי' : `עוד כ־${min} דק׳`
  }
</script>

{#if rec}
  <div class="lr rec">
    <span class="dot"></span>
    <span class="t"><b>הקלטה ארוכה</b> · {fmt(rec.seconds)}</span>
    <span class="lvl"><i style="transform:scaleX({Math.min(1, rec.level * 1.5)})"></i></span>
    <button class="stop" onclick={() => jobs.stopRecording()}><Icon name="stop" size={16} fill stroke={1.5} /> סיום</button>
  </div>
{:else if job && job.status !== 'recording'}
  <div class="lr work">
    <Icon name="wave" size={18} />
    {#if job.status === 'error'}
      <span class="t">התמלול נעצר.</span>
      <button class="link" onclick={() => jobs.retry(job.id)}>להמשיך</button>
    {:else}
      <span class="t">
        <b>מתמלל ברקע</b> · {job.done}/{job.files.length}
        {#if eta()}<span class="muted"> · {eta()}</span>{/if}
      </span>
      <span class="bar"><i style="width:{job.files.length ? Math.round((job.done / job.files.length) * 100) : 0}%"></i></span>
    {/if}
  </div>
{/if}

<style>
  .lr {
    flex: none; display: flex; align-items: center; gap: 10px;
    margin: 0; padding: 8px 16px; font-size: 0.88rem;
    border-top: 1px solid var(--line); background: var(--surface-2);
  }
  :global([data-theme='eink']) .lr { background: #fff; border-top: 1.5px solid #000; }
  .t { flex: none; white-space: nowrap; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--danger); animation: pulse 1.4s infinite; flex: none; }
  .lvl { flex: 1; height: 6px; border-radius: 6px; background: var(--surface-3); overflow: hidden; }
  .lvl i { display: block; height: 100%; width: 100%; background: var(--accent); transform-origin: right; }
  .stop { display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px; border-radius: 99px; background: var(--text); color: var(--bg); font-weight: 700; font-size: 0.85rem; }
  .bar { flex: 1; height: 6px; border-radius: 6px; background: var(--surface-3); overflow: hidden; }
  .bar i { display: block; height: 100%; background: var(--accent); }
  .work { color: var(--muted); }
  .work b { color: var(--text); }
  .link { color: var(--accent-text); font-weight: 700; }
</style>
