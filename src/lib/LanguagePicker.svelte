<script lang="ts">
  import { Check, Globe } from '@lucide/svelte';
  import { locale, setLanguage, t, type Locale } from './i18n';

  let { compact = true }: { compact?: boolean } = $props();
  const names: Record<Locale, string> = { fr: 'Français', en: 'English', de: 'Deutsch', nl: 'Nederlands' };
  const languages: readonly Locale[] = ['fr', 'en', 'de', 'nl'];
  let picker: HTMLDetailsElement;
  let trigger: HTMLElement;
  let open = $state(false);

  function choose(language: Locale) {
    setLanguage(language);
    open = false;
    trigger.focus();
  }
  function outside(event: PointerEvent) {
    if (open && event.target instanceof Node && !picker.contains(event.target)) open = false;
  }
  function escape(event: KeyboardEvent) {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      open = false;
      trigger.focus();
    }
  }
  function leave(event: FocusEvent) {
    if (open && event.relatedTarget instanceof Node && !picker.contains(event.relatedTarget)) open = false;
  }
  function triggerKey(event: KeyboardEvent) {
    // Native summary handles Enter/Space. Keep the reader's global transport
    // shortcuts from consuming those keys or navigating notes behind the menu.
    if (event.code === 'Space' || event.key === 'Enter' || event.key.startsWith('Arrow')) event.stopPropagation();
  }
</script>

<svelte:window onpointerdown={outside} onkeydown={escape} />

<details class="language-picker" class:compact bind:this={picker} bind:open onfocusout={leave}>
  <summary bind:this={trigger} onkeydown={triggerKey} aria-expanded={open} aria-label={$t('Langue de l’interface')} title={$t('Langue sélectionnée : {language}', { language: names[$locale] })}>
    <Globe size={18} aria-hidden="true" /><span class="language-name" lang={$locale}>{names[$locale]}</span>
  </summary>
  <ul aria-label={$t('Langue de l’interface')}>
    {#each languages as language}
      <li><button type="button" lang={language} aria-pressed={$locale === language} onclick={() => choose(language)}><span>{names[language]}</span>{#if $locale === language}<Check size={16} aria-hidden="true" />{/if}</button></li>
    {/each}
  </ul>
</details>

<style>
  .language-picker { position: relative; flex-shrink: 0; }
  summary { display: flex; align-items: center; justify-content: center; gap: 7px; min-height: 36px; padding: 8px 11px; list-style: none; cursor: pointer; border: 1px solid var(--line); border-radius: 7px; background: var(--paper); color: var(--ink); font-size: 12px; line-height: 1.2; white-space: nowrap; }
  summary::-webkit-details-marker { display: none; }
  summary:hover, .language-picker[open] summary { border-color: var(--accent); color: var(--accent); }
  summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .compact summary { width: 36px; padding: 7px; }
  .compact .language-name { display: none; }
  ul { position: absolute; z-index: 70; top: calc(100% + 7px); right: 0; min-width: 180px; max-width: calc(100vw - 24px); margin: 0; padding: 5px; list-style: none; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); box-shadow: 0 7px 24px #14213b26; }
  li { margin: 0; padding: 0; }
  li button { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%; min-height: 40px; padding: 9px 10px; border-radius: 5px; font-size: 13px; text-align: left; color: var(--ink); }
  li button:hover, li button[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); }
  @media(max-width:650px) { summary { width: 36px; padding: 7px; } .language-name { display: none; } }
</style>
