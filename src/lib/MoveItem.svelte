<script lang="ts">
  import { t, translate } from './i18n';
  import { moveFolder, moveItem, storageScope } from './storage';
  import { folderFor, type Organization, type OrganizationTarget } from './organization';
  import LibraryDialog from './LibraryDialog.svelte';
  let {
    organization,
    target,
    title,
    blocked = false,
    onerror,
  }: {
    organization: Organization;
    target: OrganizationTarget;
    title: string;
    blocked?: boolean;
    onerror: (message: string) => void;
  } = $props();
  let request = $state<{
    scope: string;
    target: OrganizationTarget;
    title: string;
    destination: string;
  } | null>(null);
  let working = $state(false);
  function begin() {
    request = {
      scope: storageScope(),
      target: { ...target },
      title,
      destination:
        (target.kind === 'folder'
          ? organization.folder(target.id)?.parentId
          : folderFor(organization, target.kind, target.id)) ?? '',
    };
  }
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!request || request.scope !== storageScope() || blocked || working) return;
    const { scope, target, destination } = request;
    working = true;
    try {
      if (target.kind === 'folder') await moveFolder(target.id, destination || null, scope);
      else await moveItem(target.kind, target.id, destination || null, scope);
      if (scope === storageScope()) request = null;
    } catch (cause) {
      onerror(
        cause instanceof Error
          ? translate(cause.message)
          : translate('Impossible de déplacer cet élément.'),
      );
    } finally {
      working = false;
    }
  }
</script>

<button
  type="button"
  disabled={blocked || working}
  aria-label={$t('Déplacer « {title} » vers…', { title })}
  onclick={begin}
>
  {$t('Déplacer vers…')}
</button>
{#if request}
  <LibraryDialog
    label={$t('Déplacer « {title} » vers…', { title: request.title })}
    onclose={() => (request = null)}
  >
    <form onsubmit={submit}>
      <label for="move-destination">{$t('Dossier de destination')}</label>
      <select id="move-destination" bind:value={request.destination} disabled={blocked || working}>
        <option value="">
          {$t(request.target.kind === 'folder' ? 'Racine de la bibliothèque' : 'Non classés')}
        </option>
        {#each organization.destinations(request.target.kind === 'folder' ? request.target.id : undefined) as folder (folder.id)}
          <option value={folder.id}>{organization.path(folder.id)}</option>
        {/each}
      </select>
      <div class="dialog-actions">
        <button type="submit" disabled={blocked || working}>{$t('Déplacer')}</button>
        <button type="button" onclick={() => (request = null)}>{$t('Annuler')}</button>
      </div>
    </form>
  </LibraryDialog>
{/if}

<style>
  button {
    min-height: 44px;
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    font-size: 12px;
  }
</style>
