<script lang="ts">
  import { t } from './i18n';
  import { Sun, Moon, Monitor } from '@lucide/svelte';
  import { themePreference, cycleTheme } from './theme';
  let { compact = false }: { compact?: boolean } = $props();

  const labels = { system: 'Système', light: 'Jour', dark: 'Nuit' };
  const next = { system: 'light', light: 'dark', dark: 'system' } as const;
  const description = $derived($t('Thème : {current}. Passer au mode {next}', { current: $t(labels[$themePreference]), next: $t(labels[next[$themePreference]]) }));
</script>

<button class="theme-toggle" class:compact type="button" title={description} aria-label={description} onclick={cycleTheme}>
  {#if $themePreference === 'dark'}<Moon size={17} />{:else if $themePreference === 'light'}<Sun size={17} />{:else}<Monitor size={17} />{/if}
  <span>{$t(labels[$themePreference])}</span>
</button>

<style>
  .theme-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-width: 36px;
    min-height: 36px;
    padding: 8px 11px;
    border: 1px solid var(--line);
    border-radius: 7px;
    background: var(--paper);
    color: var(--ink);
    font-size: 12px;
    line-height: 1.2;
    white-space: nowrap;
  }
  .theme-toggle:hover { border-color: var(--accent); color: var(--accent); }
  .compact { width: 36px; min-width: 36px; min-height: 36px; padding: 7px; }
  .compact span { display: none; }
  @media(max-width:650px) {
    .theme-toggle { width: 36px; min-width: 36px; min-height: 36px; padding: 7px; }
    .theme-toggle span { display: none; }
  }
</style>
