<script lang="ts">
  import { t } from './i18n';
  import { onMount, untrack } from 'svelte';
  import { X, LogOut, UserRound, LoaderCircle } from '@lucide/svelte';
  import { syncState, login, createAccount, logout, resetPassword, deleteAccount } from './sync';

  let { onclose, beforechange, blocked = false, invitation = $bindable(''), resetToken = $bindable(''), ondelete = (_scope: string) => {} }: {
    onclose: () => void; beforechange: () => Promise<void>; blocked?: boolean; invitation?: string; resetToken?: string; ondelete?: (scope: string) => void;
  } = $props();
  let mode = $state<'login' | 'register'>(untrack(() => invitation ? 'register' : 'login'));
  $effect(() => { if (invitation) mode = 'register'; });
  let email = $state('');
  let password = $state('');
  let working = $state(false);
  let error = $state('');
  let message = $state('');
  let confirmPassword = $state('');
  let deletePassword = $state('');
  let confirmedDelete = $state(false);
  let recoveryHelp = $state(false);
  let dialog: HTMLDivElement;
  async function perform(action: () => Promise<unknown>, changingAccount = false) {
    if (working || blocked) return;
    working = true; error = ''; message = '';
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
  function recover(event: SubmitEvent) {
    event.preventDefault();
    if (password !== confirmPassword) { error = 'Les mots de passe ne correspondent pas.'; return; }
    void perform(async () => {
      await resetPassword(resetToken, password);
      resetToken = ''; confirmPassword = ''; mode = 'login';
      message = 'Mot de passe mis à jour. Vous pouvez vous connecter.';
    }, true);
  }
  function remove(event: SubmitEvent) {
    event.preventDefault();
    if (!confirmedDelete || !$syncState.user) return;
    void perform(async () => {
      await deleteAccount(deletePassword, ondelete);
      deletePassword = ''; confirmedDelete = false;
      message = 'Votre compte et ses données ont été supprimés.';
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
    <button class="close icon-button" aria-label={$t("Fermer le compte")} onclick={onclose}><X size={20} /></button>
    <h2 id="account-title"><UserRound size={23} /> {$t('Compte')}</h2>
    {#if blocked}<p class="warning">{$t("Terminez l’enregistrement avant de changer de compte ou de bibliothèque.")}</p>{/if}
    {#if resetToken}
      <p>{$t('Choisissez un nouveau mot de passe. Le lien de récupération ne peut être utilisé qu’une fois.')}</p>
      <form onsubmit={recover}>
        <label for="reset-password">{$t('Nouveau mot de passe')}</label><input id="reset-password" type="password" autocomplete="new-password" minlength="12" maxlength="256" bind:value={password} required disabled={working || blocked} />
        <small>{$t('Au moins 12 caractères.')}</small>
        <label for="reset-confirm">{$t('Confirmer le mot de passe')}</label><input id="reset-confirm" type="password" autocomplete="new-password" minlength="12" maxlength="256" bind:value={confirmPassword} required disabled={working || blocked} />
        <button class="primary-button" type="submit" disabled={working || blocked}>{$t('Changer le mot de passe')}</button>
      </form>
    {:else if $syncState.user}
      <p class="account-email">{$syncState.user.email}</p>
      <div class="sync-status" role="status">{#if $syncState.busy}<LoaderCircle class="spin" size={15} />{/if}<span>{$t($syncState.status)}{#if $syncState.pending} · {$t($syncState.pending > 1 ? "{count} modifications" : "{count} modification", { count: $syncState.pending })}{/if}</span></div>
      <p>{$t("Partitions, réglages et enregistrements se synchronisent automatiquement avec votre compte.")}</p>
      {#if $syncState.message}<p class="warning">{$t($syncState.message)}</p>{/if}
      <p class="data-note">{$t('Lorsque vous êtes connecté, vos partitions, réglages, enregistrements et courbes sont envoyés au serveur pour les retrouver sur vos autres appareils. Le traitement du son reste sur cet appareil.')}</p>
      <button class="logout secondary" disabled={working || blocked} onclick={() => void perform(logout, true)}><LogOut size={15} /> {$t('Se déconnecter')}</button>
      <details class="account-management"><summary>{$t('Supprimer mon compte')}</summary>
        <p>{$t('Cette action supprime définitivement le compte, les partitions et les enregistrements du serveur et de ce navigateur. Les copies sur vos autres appareils et dans les sauvegardes ne sont pas effacées immédiatement.')}</p>
        <form onsubmit={remove}>
          <label for="delete-password">{$t('Mot de passe actuel')}</label><input id="delete-password" type="password" autocomplete="current-password" maxlength="256" bind:value={deletePassword} required disabled={working || blocked} />
          <label class="delete-confirm"><input type="checkbox" bind:checked={confirmedDelete} disabled={working || blocked} />{$t('Je confirme la suppression de mon compte et de ses données.')}</label>
          <button class="delete-account" type="submit" disabled={working || blocked || !confirmedDelete}>{$t('Supprimer définitivement')}</button>
        </form>
      </details>
    {:else}
      <div class="tabs" aria-label={$t("Connexion ou création de compte")}><button class:active={mode === 'login'} onclick={() => { mode = 'login'; error = ''; }}>{$t("Connexion")}</button><button class:active={mode === 'register'} onclick={() => { mode = 'register'; error = ''; }}>{$t("Créer un compte")}</button></div>
      <p>{$t("La connexion permet de retrouver les partitions, réglages et enregistrements sur vos autres appareils. Le lecteur fonctionne aussi sans compte.")}</p>
      <form onsubmit={submit}>
        <label for="account-email">{$t("Adresse e-mail")}</label><input id="account-email" name="email" type="email" autocomplete="email" bind:value={email} required maxlength="254" disabled={working || blocked} />
        <label for="account-password">{$t("Mot de passe")}</label><input id="account-password" name="password" type="password" autocomplete={mode === 'login' ? 'current-password' : 'new-password'} bind:value={password} required minlength={mode === 'register' ? 12 : 1} maxlength="256" disabled={working || blocked} />
        {#if mode === 'register'}
          <small>{$t("Au moins 12 caractères.")}</small>
          {#if $syncState.registration === 'invite'}<label for="account-invitation">{$t("Code d’invitation")}</label><input id="account-invitation" name="invitation" type="text" autocomplete="off" bind:value={invitation} required maxlength="256" disabled={working || blocked} /><small>{$t("Les comptes sont actuellement ouverts sur invitation.")}</small>{/if}
        {/if}
        <button class="primary-button" type="submit" disabled={working || blocked}>{#if working}<LoaderCircle class="spin" size={16} />{/if}{mode === 'login' ? $t('Se connecter') : $t('Créer le compte')}</button>
      </form>
      {#if mode === 'login'}<button class="text-button recovery-help" onclick={() => recoveryHelp = !recoveryHelp}>{$t('Mot de passe oublié ?')}</button>{#if recoveryHelp}<p>{$t('Pendant la bêta sur invitation, demandez un lien de récupération à la personne qui vous a invité.')}</p>{/if}{/if}
    {/if}
    {#if message}<p class="account-message" role="status">{$t(message)}</p>{/if}
    {#if error}<p class="warning" role="alert">{$t(error)}</p>{/if}
  </div>
</div>

<style>
  .data-note { font-size: 12px; }
  .account-management { margin-top: 20px; border-top: 1px solid var(--line); padding-top: 16px; font-size: 13px; }
  .account-management summary { cursor: pointer; }
  .account-management p { margin-top: 14px; }
  .delete-confirm { display: flex; align-items: flex-start; gap: 9px; line-height: 1.5; }
  .delete-confirm input { width: auto; margin-top: 4px; flex-shrink: 0; }
  .delete-account { min-height: 42px; padding: 10px; border: 1px solid var(--coral); border-radius: 6px; color: var(--coral); }
  .recovery-help { margin-top: 14px; }
  .account-message { color: var(--accent); font-size: 13px; margin-top: 18px; }

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
