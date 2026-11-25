<script lang="ts">
  import Icon from './Icon.svelte'
  let {
    icon = '',
    label,
    hint = '',
    danger = false,
    selected = false,
    onclick,
  }: { icon?: string; label: string; hint?: string; danger?: boolean; selected?: boolean; onclick?: () => void } = $props()
</script>

<button class="mi" class:danger class:selected {onclick}>
  {#if icon}<span class="ic"><Icon name={icon} size={21} /></span>{/if}
  <span class="txt">
    <span class="lbl">{label}</span>
    {#if hint}<span class="hint">{hint}</span>{/if}
  </span>
  {#if selected}<span class="tick"><Icon name="check" size={20} stroke={2.4} /></span>{/if}
</button>

<style>
  .mi {
    width: 100%; display: flex; align-items: center; gap: 14px;
    min-height: 54px; padding: 8px 22px; text-align: start;
    transition: background var(--speed);
  }
  .mi:active { background: var(--surface-2); }
  .ic { color: var(--muted); display: grid; }
  .txt { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .lbl { font-size: 1.02rem; font-weight: 500; }
  .hint { font-size: 0.84rem; color: var(--muted); }
  .danger, .danger .ic { color: var(--danger); }
  .selected .lbl { font-weight: 700; color: var(--accent-text); }
  .tick { color: var(--accent-text); }
</style>
