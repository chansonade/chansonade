<script lang="ts">
  import { Code2 } from '@lucide/svelte';
  let { compact = false }: { compact?: boolean } = $props();
  const repository = import.meta.env.VITE_REPOSITORY_URL || '';
  const href = repository || `${import.meta.env.BASE_URL}source/chansonade-source.tar.gz`;
  const label = repository ? 'Code source sur GitHub' : 'Télécharger le code source';
</script>

<a class="repository-link" class:compact {href} target={repository ? '_blank' : undefined} rel={repository ? 'noopener noreferrer' : undefined} aria-label={label} title={label}>
  {#if repository}
    <img class="day" src="{import.meta.env.BASE_URL}brands/github-black.svg" alt="" width="19" height="19" />
    <img class="night" src="{import.meta.env.BASE_URL}brands/github-white.svg" alt="" width="19" height="19" />
  {:else}<Code2 size={19} />{/if}
  <span>{repository ? 'GitHub' : 'Sources'}</span>
</a>

<style>
  .repository-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-height: 36px;
    padding: 8px 11px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--paper);
    color: var(--ink);
    font-size: 11px;
  }
  .repository-link:hover { border-color: var(--accent); }
  img { flex-shrink: 0; }
  .night { display: none; }
  :global([data-theme="dark"]) .day { display: none; }
  :global([data-theme="dark"]) .night { display: block; }
  .compact { width: 34px; min-height: 34px; padding: 7px; }
  .compact span { display: none; }
  @media(max-width:650px) {
    .repository-link { width: 34px; min-height: 34px; padding: 7px; }
    span { display: none; }
  }
</style>
