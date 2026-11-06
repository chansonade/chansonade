<script lang="ts">
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';
  import { subscribeStorage } from './storage';
  let { label, onclose, children }: { label: string; onclose: () => void; children: Snippet } = $props();
  let dialog: HTMLDialogElement;
  onMount(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = opener?.closest('.library-panel, .take-panel');
    dialog.showModal();
    const stop = subscribeStorage(event => { if (event.reason === 'scope') onclose(); });
    return () => { stop(); dialog.close(); const anchor = panel?.querySelector('.root-select') as HTMLElement | null; if (anchor) anchor.focus(); else if (opener?.isConnected && !opener.matches(':disabled')) opener.focus(); else (panel?.querySelector('button') as HTMLElement | null)?.focus(); };
  });
</script>
<dialog bind:this={dialog} aria-label={label} oncancel={event => { event.preventDefault(); onclose(); }} onkeydown={event => event.stopPropagation()}>
  <h2>{label}</h2>
  {@render children()}
</dialog>
<style>
  dialog { width:min(440px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;margin:auto;padding:20px;border:1px solid var(--line);border-radius:12px;background:var(--paper);color:var(--ink);box-shadow:0 12px 50px #0004; }
  dialog::backdrop { background:#10192b80; } h2 { font-size:17px;margin:0 0 16px; }
  dialog :global(button),dialog :global(select),dialog :global(input) { min-height:44px; }
  dialog :global(input),dialog :global(select) { width:100%;border:1px solid var(--line);border-radius:7px;padding:10px;background:var(--paper);color:var(--ink); }
  dialog :global(label) { display:block;font-size:13px;margin-bottom:8px; }
  dialog :global(.dialog-actions) { display:flex;gap:8px;flex-wrap:wrap;margin-top:18px; }
  dialog :global(.dialog-actions button) { padding:10px 14px;border:1px solid var(--line);border-radius:7px; }
  dialog :global(.dialog-actions button[type=submit]) { background:var(--accent);color:var(--paper); }
  dialog :global(p) { line-height:1.6;font-size:13px;margin:10px 0; }
</style>
