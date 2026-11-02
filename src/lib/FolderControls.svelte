<script lang="ts">
  import { t, translate } from './i18n';
  import { onMount } from 'svelte';
  import { Folder, FolderPlus, Pencil, Trash2, Check, X } from '@lucide/svelte';
  import { createFolder, renameFolder, deleteFolder, storageScope, subscribeStorage, type OrganizationSnapshot } from './storage';
  let { organization, selected = $bindable('all'), onrefresh, onerror, blocked = false }: { organization: OrganizationSnapshot; selected?: string; onrefresh: () => Promise<unknown>; onerror: (message:string) => void; blocked?: boolean } = $props();
  let edit = $state<'create'|'rename'|null>(null);
  let name = $state('');
  let working = $state(false);
  let confirmDelete = $state(false);
  const folder = $derived(organization.folders.find(folder => folder.id === selected));
  $effect(() => { if(selected !== 'all' && selected !== 'unfiled' && !organization.folders.some(folder => folder.id === selected)) selected = 'unfiled'; });
  onMount(() => subscribeStorage(event => { if(event.reason === 'scope') { edit = null; name = ''; confirmDelete = false; selected = 'all'; } }));
  function begin(mode:'create'|'rename') { edit = mode; name = mode === 'rename' ? folder?.name || '' : ''; confirmDelete = false; }
  async function save(event: SubmitEvent) {
    event.preventDefault(); if (!name.trim() || working || blocked) return;
    const scope = storageScope(); working = true;
    try {
      const id = edit === 'create' ? await createFolder(name, scope) : selected;
      if (edit === 'rename') await renameFolder(id, name, scope);
      await onrefresh();
      if (scope === storageScope()) { selected = id; edit = null; }
    } catch(cause) { onerror(cause instanceof Error ? translate(cause.message) : translate("Impossible de sauvegarder ce dossier.")); }
    finally { working = false; }
  }
  async function remove() {
    if (!folder || working || blocked) return;
    if (!confirmDelete) { confirmDelete = true; return; }
    const scope = storageScope(), id = folder.id; working = true;
    try { await deleteFolder(id, scope); await onrefresh(); if(scope === storageScope()) { selected = 'unfiled'; confirmDelete = false; } }
    catch(cause) { onerror(cause instanceof Error ? translate(cause.message) : translate("Impossible de supprimer ce dossier.")); }
    finally { working = false; }
  }
</script>

<div class="folder-controls">
  <div class="folder-row"><Folder size={15} /><select aria-label={$t("Filtrer par dossier")} bind:value={selected} onchange={() => { confirmDelete = false; edit = null; }}><option value="all">{$t("Tous les dossiers")}</option><option value="unfiled">{$t("Non classés")}</option>{#each organization.folders as entry}<option value={entry.id}>{entry.name}</option>{/each}</select><button class="icon-button" aria-label={$t("Créer un dossier")} title={$t("Créer un dossier")} disabled={blocked || working} onclick={() => begin('create')}><FolderPlus size={17} /></button>{#if folder}<button class="icon-button" aria-label={$t("Renommer le dossier")} title={$t("Renommer le dossier")} disabled={blocked || working} onclick={() => begin('rename')}><Pencil size={15} /></button><button class="icon-button" aria-label={$t("Supprimer le dossier")} title={$t("Supprimer le dossier")} disabled={blocked || working} onclick={() => void remove()}><Trash2 size={15} /></button>{/if}</div>
  {#if edit}<form onsubmit={save}><input aria-label={$t("Nom du dossier")} placeholder={$t("Nom du dossier")} maxlength="100" bind:value={name} required disabled={working} /><button class="icon-button" aria-label={$t("Enregistrer le dossier")} type="submit" disabled={working || !name.trim()}><Check size={17} /></button><button class="icon-button" aria-label={$t("Annuler")} type="button" onclick={() => edit = null}><X size={17} /></button></form>{/if}
  {#if confirmDelete}<div class="folder-delete"><p>{$t("Les partitions et essais seront conservés dans « Non classés ».")}</p><button disabled={working} onclick={() => void remove()}>{$t("Supprimer ce dossier")}</button><button onclick={() => confirmDelete = false}>{$t("Annuler")}</button></div>{/if}
</div>

<style>
  .folder-controls { margin:12px 0; } .folder-row,form { display:flex;align-items:center;gap:4px;min-width:0; } .folder-row> :global(svg) { flex-shrink:0;color:var(--subtle); }
  select { flex:1;width:0;font-size:12px;padding:8px 5px; } .icon-button { width:30px;height:34px;flex-shrink:0; }
  form { margin-top:8px; } input { flex:1;min-width:0;border:1px solid var(--line);background:var(--paper);color:var(--ink);border-radius:6px;padding:9px;font-size:13px; }
  .folder-delete { margin-top:8px;border:1px solid var(--line);border-radius:6px;padding:10px;background:var(--paper);font-size:12px;line-height:1.5; } .folder-delete button { padding:8px 3px;color:var(--accent);font-size:12px; }
</style>
