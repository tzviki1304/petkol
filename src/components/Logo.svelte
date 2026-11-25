<script lang="ts">
  // The פתקול mark: a note sheet with a folded corner, and a voice wave written on it.
  let { size = 40, mono = false }: { size?: number; mono?: boolean } = $props()
</script>

<svg width={size} height={size} viewBox="0 0 64 64" aria-label="פתקול" role="img" style="flex:none">
  <rect x="2" y="2" width="60" height="60" rx="16" fill={mono ? '#fff' : 'var(--accent)'} stroke={mono ? '#000' : 'none'} stroke-width="3" />
  <path d="M18 14h20l9 9v25a3 3 0 0 1-3 3H18a3 3 0 0 1-3-3V17a3 3 0 0 1 3-3z" fill={mono ? '#fff' : '#fffaf3'} stroke={mono ? '#000' : 'none'} stroke-width="2.5" />
  <path d="M38 14v6a3 3 0 0 0 3 3h6z" fill={mono ? '#000' : '#f0d9c9'} />
  <g stroke={mono ? '#000' : 'var(--accent)'} stroke-width="3.2" stroke-linecap="round">
    <path d="M22 33v4" />
    <path d="M27 29v12" />
    <path d="M32 26v18" />
    <path d="M37 30v10" />
    <path d="M42 33v4" />
  </g>
</svg>
