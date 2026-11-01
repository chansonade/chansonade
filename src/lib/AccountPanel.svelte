<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { X, LogOut, UserRound, LoaderCircle } from '@lucide/svelte';
  import { syncState, login, createAccount, logout } from './sync';

  let { onclose, beforechange, blocked = false, invitation = $bindable('') }: {
    onclose: () => void; beforechange: () => Promise<void>; blocked?: boolean; invitation?: string;
  } = $props();
  let mode = $state<'login' | 'register'>(untrack(() => invitation ? 'register' : 'login'));
  $effect(() => { if (invitation) mode = 'register'; });
  let email = $state('');
  let password = $state('');
  let working = $state(false);
  let error = $state('');
  let dialog: HTMLDivElement;
  async function perform(action: () => Promise<unknown>, changingAccount = false) {
    if (working || blocked) return;
    working = true; error = '';
    try {
      if (changingAccount) await beforechange();
      await action();
      password = '';
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally { working = false; }
  }
  function submit(event: SubmitEvent) {
    event.preventDefault();
    void perform(async () => {
      if (mode === 'register') { await createAccount(email, password, invitation.trim() || undefined); invitation = ''; }
      else await login(email, password);
    }, true);
  }
  function keyboard(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === 'Escape') onclose();
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]')];
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  onMount(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.querySelector<HTMLElement>('input, button')?.focus();
    return () => previous?.focus();
  });
</script>

<div class="account-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) onclose(); }}>
  <div class="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-title" tabindex="-1" bind:this={dialog} onkeydown={keyboard}>
    <button class="close icon-button" aria-label="Fermer le compte" onclick={onclose}><X size={20} /></button>
    <h2 id="account-title"><UserRound size={23} /> Compte</h2>
    {#if blocked}<p class="warning">Terminez l’enregistrement avant de changer de compte ou de bibliothèque.</p>{/if}
    {#if $syncState.user}
      <p class="account-email">{$syncState.user.email}</p>
      <div class="sync-status" role="status">{#if $syncState.busy}<LoaderCircle class="spin" size={15} />{/if}<span>{$syncState.status}{#if $syncState.pending} · {$syncState.pending} modification{$syncState.pending > 1 ? 's' : ''}{/if}</span></div>
      <p>Partitions, réglages et enregistrements se synchronisent automatiquement avec votre compte.</p>
      {#if $syncState.message}<p class="warning">{$syncState.message}</p>{/if}
      <button class="logout secondary" disabled={working || blocked} onclick={() => void perform(logout, true)}><LogOut size={15} /> Se déconnecter</button>
    {:else}
      <div class="tabs" aria-label="Connexion ou création de compte"><button class:active={mode === 'login'} onclick={() => { mode = 'login'; error = ''; }}>Connexion</button><button class:active={mode === 'register'} onclick={() => { mode = 'register'; error = ''; }}>Créer un compte</button></div>
      <p>La connexion permet de retrouver les partitions, réglages et enregistrements sur vos autres appareils. Le lecteur fonctionne aussi sans compte.</p>
      <form onsubmit={submit}>
        <label for="account-email">Adresse e-mail</label><input id="account-email" name="email" type="email" autocomplete="email" bind:value={email} required maxlength="254" disabled={working || blocked} />
        <label for="account-password">Mot de passe</label><input id="account-password" name="password" type="password" autocomplete={mode === 'login' ? 'current-password' : 'new-password'} bind:value={password} required minlength={mode === 'register' ? 12 : 1} maxlength="256" disabled={working || blocked} />
        {#if mode === 'register'}
          <small>Au moins 12 caractères.</small>
          {#if $syncState.registration === 'invite'}<label for="account-invitation">Code d’invitation</label><input id="account-invitation" name="invitation" type="text" autocomplete="off" bind:value={invitation} required maxlength="256" disabled={working || blocked} /><small>Les comptes sont actuellement ouverts sur invitation.</small>{/if}
        {/if}
        <button class="primary-button" type="submit" disabled={working || blocked}>{#if working}<LoaderCircle class="spin" size={16} />{/if}{mode === 'login' ? 'Se connecter' : 'Créer le compte'}</button>
      </form>
    {/if}
    {#if error}<p class="warning" role="alert">{error}</p>{/if}
  </div>
</div>

<style>
  .account-backdrop {
    position: fixed;
    inset: 0;
    z-index: 220;
    backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  .account-dialog {
    position: relative;
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 30px;
    max-width: 510px;
    width: 100%;
    max-height: 92dvh;
    overflow: auto;
    box-shadow: 0 20px 100px #16321d30;
    font-size: 13px;
  }
  .close {
    position: absolute;
    right: 12px;
    top: 12px;
  }
  .account-dialog h2 {
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: var(--serif);
    margin: 0 0 20px;
  }
  .account-dialog p {
    line-height: 1.7;
    margin: 12px 0;
  }
  .account-email {
    overflow-wrap: anywhere;
  }
  .sync-status {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
  }
  .sync-status>span {
    font-size: 13px;
  }
  .secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    border: 1px solid #d2d8c8;
    border-radius: 6px;
    padding: 9px 11px;
    font-size: 13px;
    line-height: 1.5;
  }
  .logout {
    margin-top: 8px;
  }
  .tabs {
    display: flex;
    gap: 5px;
    border-bottom: 1px solid var(--line);
    margin-bottom: 17px;
  }
  .tabs button {
    font-size: 13px;
    padding: 10px 13px;
    border-bottom: 2px solid transparent;
  }
  .tabs button.active {
    border-bottom-color: var(--accent);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 20px;
  }
  form label {
    font-size: 13px;
    margin-top: 7px;
  }
  form input {
    width: 100%;
    font: inherit;
    padding: 11px;
    border: 1px solid #d2d8c8;
    border-radius: 5px;
  }
  form small {
    font-size: 13px;
    line-height: 1.5;
  }
  form .primary-button {
    margin-top: 15px;
    justify-content: center;
    display: flex;
    gap: 8px;
  }
  .account-dialog .warning {
    color: #9a4b37;
    background: #f3e6dc;
    border-radius: 6px;
    padding: 10px 12px;
  }
  @media(max-width:550px) {
    .account-backdrop {
      padding: 12px;
    }
    .account-dialog {
      padding: 25px 20px;
    }
    .sync-status {
      align-items: flex-start;
    }
  }
  .account-backdrop {
    background: #10203b80;
  }
  .account-dialog {
    background: var(--paper);
    border-color: var(--line);
    color: var(--ink);
  }
  .account-dialog h2 {
    font-weight: 650;
    font-size: 26px;
    letter-spacing: -.5px;
  }
  .account-dialog p,.tabs button,form label,form small {
    color: var(--subtle);
  }
  .sync-status>span,.tabs button.active {
    color: var(--accent);
  }
  .secondary {
    background: var(--cream);
    border-color: var(--line);
    color: var(--ink);
  }
  form input {
    background: var(--surface);
    border-color: var(--line);
    color: var(--ink);
  }
</style>
