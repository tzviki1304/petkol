<script lang="ts">
  import type { Snippet } from 'svelte'
  let { open = $bindable(false), title = '', children, onclose }: { open?: boolean; title?: string; children: Snippet; onclose?: () => void } = $props()

  function close() {
    open = false
    onclose?.()
  }
</script>

{#if open}
  <div class="scrim" role="presentation" onclick={close}></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-label={title}>
    <div class="grip"></div>
    {#if title}<div class="sheet-title">{title}</div>{/if}
    <div class="sheet-body">{@render children()}</div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed; inset: 0; background: var(--scrim); z-index: 50;
    animation: fade-in var(--speed) ease;
  }
  .sheet {
    position: fixed; inset-inline: 0; bottom: 0; z-index: 51;
    max-height: 86vh; display: flex; flex-direction: column;
    background: var(--surface); border-radius: 24px 24px 0 0;
    box-shadow: var(--shadow-lg);
    padding-bottom: calc(var(--safe-bottom) + 10px);
    animation: rise 220ms cubic-bezier(.2,.8,.2,1);
    max-width: 640px; margin: 0 auto;
  }
  :global([data-theme='eink']) .sheet { border: 2px solid #000; border-bottom: none; }
  .grip { width: 40px; height: 4.5px; border-radius: 9px; background: var(--line-strong); margin: 10px auto 2px; }
  .sheet-title {
    font-family: var(--font-display); font-weight: 700; font-size: 1.2rem;
    padding: 8px 22px 6px;
  }
  .sheet-body { overflow-y: auto; padding: 4px 0 6px; }
</style>
