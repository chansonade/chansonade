<script module lang="ts">
  export type LibraryNavigation = { current: string; expanded: string[] };
</script>
<script lang="ts">
  import { Folder, ChevronDown, ChevronRight, MoreHorizontal, Music2, AudioLines, Trash2, FolderPlus } from '@lucide/svelte';
  import { t, translate } from './i18n';
  import { matchesSearch } from './catalog';
  import { createFolder, renameFolder, trashFolder, trashItem, restoreFolder, restoreItem, purgeTrash, storageScope, subscribeStorage, type SavedScore } from './storage';
  import type { Organization, OrganizationTarget } from './organization';
  import { onMount, tick } from 'svelte';
  import MoveItem from './MoveItem.svelte';
  import LibraryDialog from './LibraryDialog.svelte';
  type FileEntry = { kind: 'score' | 'take'; id: string; title: string; subtitle: string };
  let { organization, scores, takes, scope, currentId, navigation = $bindable(), search = $bindable(''), blocked = false, onopen, onerror }: {
    organization: Organization; scores: SavedScore[]; takes: { id: string; title: string }[]; scope: string; currentId: string;
    navigation: LibraryNavigation; search?: string; blocked?: boolean; onopen: (score: SavedScore) => void; onerror: (message: string) => void;
  } = $props();
  let working = $state(false), notice = $state('');
  let tree: HTMLDivElement;
  async function focusNavigation() { await tick(); (tree?.querySelector(navigation.current === 'trash' ? '.trash-select' : '.root-select') as HTMLElement | null)?.focus(); }
  let menu = $state<OrganizationTarget | null>(null);
  let editing = $state<{ mode: 'create'; parent: string | null } | { mode: 'rename'; id: string } | null>(null);
  let name = $state('');
  let removing = $state<OrganizationTarget | 'all' | null>(null);
  const files = $derived<FileEntry[]>([...scores.map(score => ({ kind: 'score' as const, id: score.id, title: score.title, subtitle: score.composer })), ...takes.map(take => ({ kind: 'take' as const, id: take.id, title: take.title, subtitle: '' }))]);
  const active = $derived(scores.filter(score => organization.matches('score', score.id)));
  const destinations = $derived(organization.destinations());
  const trash = $derived(organization.trash(files));
  const roots = $derived(organization.trashRoots(files));
  const contents = $derived(removing === null ? [] : organization.trashContents(files, removing));
  const losses = $derived({ folders: contents.filter(item => item.kind === 'folder').length, scores: contents.filter(item => item.kind === 'score').length, takes: contents.filter(item => item.kind === 'take').length });
  const matching = $derived(active.filter(score => matchesSearch(search, score.title, score.composer)));
  const visibleFolders = $derived.by(() => {
    const visible = new Set<string>();
    const add = (id: string | null) => { while (id !== null) { visible.add(id); id = organization.folder(id)?.parentId ?? null; } };
    for (const folder of destinations) if (!search.trim() || matchesSearch(search, folder.data.name)) add(folder.id);
    for (const score of matching) add(organization.classify('score', score.id).folderId);
    return visible;
  });
  onMount(() => subscribeStorage(event => { if (event.reason === 'scope') { menu = null; notice = ''; } }));
  function select(id: string) { navigation = { ...navigation, current: id }; if (id === 'trash') search = ''; menu = null; }
  function toggle(id: string) { navigation = { ...navigation, expanded: navigation.expanded.includes(id) ? navigation.expanded.filter(value => value !== id) : [...navigation.expanded, id] }; }
  function title(target: OrganizationTarget) { return target.kind === 'folder' ? organization.folder(target.id)?.data.name ?? '' : files.find(file => file.kind === target.kind && file.id === target.id)?.title ?? ''; }
  function beginRename(id: string) { name = organization.folder(id)?.data.name ?? ''; editing = { mode: 'rename', id }; }
  function beginCreate() { name = ''; editing = { mode: 'create', parent: destinations.find(folder => folder.id === navigation.current)?.id ?? null }; }
  async function save(event: SubmitEvent) {
    event.preventDefault(); if (!editing || working || blocked || scope !== storageScope()) return;
    const action = editing, account = scope; working = true;
    try {
      if (action.mode === 'create') {
        await createFolder(name, action.parent, account);
        if (account === storageScope()) {
          search = '';
          if (action.parent !== null && !navigation.expanded.includes(action.parent)) navigation = { ...navigation, expanded: [...navigation.expanded, action.parent] };
        }
      } else await renameFolder(action.id, name, account);
      if (account === storageScope()) { editing = null; notice = 'Dossier enregistré.'; }
    } catch (cause) { onerror(cause instanceof Error ? translate(cause.message) : translate('Impossible de sauvegarder ce dossier.')); }
    finally { working = false; }
  }
  async function act(action: 'trash' | 'restore', target: OrganizationTarget) {
    if (working || blocked || scope !== storageScope()) return;
    const account = scope; working = true; notice = '';
    try {
      if (action === 'trash') {
        if (target.kind === 'folder') await trashFolder(target.id, account); else await trashItem(target.kind, target.id, account);
      } else {
        if (target.kind === 'folder') await restoreFolder(target.id, account); else await restoreItem(target.kind, target.id, account);
      }
      if (account === storageScope()) { menu = null; notice = action === 'trash' ? 'Élément mis à la corbeille.' : 'Élément restauré.'; await focusNavigation(); }
    } catch (cause) { onerror(cause instanceof Error ? translate(cause.message) : translate('Impossible de modifier cet élément.')); }
    finally { working = false; }
  }
  async function purge(event: SubmitEvent) {
    event.preventDefault(); if (removing === null || blocked || working || scope !== storageScope()) return;
    const selection = removing, account = scope; working = true;
    try { await purgeTrash(selection, account); if (account === storageScope()) { removing = null; menu = null; notice = 'Suppression définitive effectuée.'; } }
    catch (cause) { onerror(cause instanceof Error ? translate(cause.message) : translate('Impossible de modifier cet élément.')); }
    finally { working = false; }
  }
  function folderFiles(id: string | null, section: 'library' | 'trash'): FileEntry[] {
    return section === 'library' ? matching.filter(score => organization.classify('score', score.id).folderId === id).map(score => ({ kind: 'score', id: score.id, title: score.title, subtitle: score.composer }))
      : files.filter(file => organization.classify(file.kind, file.id).folderId === id && organization.classify(file.kind, file.id).state === 'trash');
  }
</script>

{#snippet actions(target: OrganizationTarget, section: 'library' | 'trash')}
  <div class="row-actions" aria-label={$t('Actions pour « {title} »', { title: title(target) })}>
    {#if section === 'library'}
      <MoveItem {organization} {target} title={title(target)} blocked={blocked || working} {onerror} />
      {#if target.kind === 'folder'}<button disabled={blocked || working} onclick={() => beginRename(target.id)}>{$t('Renommer le dossier')}</button>{/if}
      <button disabled={blocked || working} onclick={() => void act('trash', target)}>{$t('Mettre à la corbeille')}</button>
    {:else}
      <button disabled={blocked || working} onclick={() => void act('restore', target)}>{$t('Restaurer')}</button>
      <button disabled={blocked || working} onclick={() => removing = target}>{$t('Supprimer définitivement')}</button>
    {/if}
  </div>
{/snippet}
{#snippet fileRow(file: FileEntry, depth: number, section: 'library' | 'trash')}
  <li class="file-entry" data-kind={file.kind} data-id={file.id} style:--depth={Math.min(depth, 3)}>
    <div class="tree-row saved-piece">
      {#if section === 'library'}
        <button class="file-open piece" class:chosen={file.id === currentId} onclick={() => { const score = scores.find(item => item.id === file.id); if (score) onopen(score); }} title={file.title}>
          <Music2 size={17}/><span><strong>{file.title}</strong>{#if file.subtitle}<small>{file.subtitle}</small>{/if}</span>
        </button>
      {:else}
        <span class="file-title">{#if file.kind === 'score'}<Music2 size={17}/>{:else}<AudioLines size={17}/>{/if}<span><strong>{file.title}</strong><small>{$t(file.kind === 'score' ? 'Partition' : 'Essai')}</small></span></span>
      {/if}
      <button class="more" aria-label={$t('Actions pour « {title} »', { title: file.title })} aria-expanded={menu?.kind === file.kind && menu.id === file.id} onclick={() => menu = menu?.kind === file.kind && menu.id === file.id ? null : file}><MoreHorizontal size={18}/></button>
    </div>
    {#if menu?.kind === file.kind && menu.id === file.id}{@render actions(file, section)}{/if}
  </li>
{/snippet}
{#snippet folderRow(id: string, depth: number, section: 'library' | 'trash')}
  {@const folder = organization.folder(id)!}
  {@const opened = section === 'library' && search.trim() ? true : navigation.expanded.includes(id)}
  {@const count = active.filter(score => organization.matches('score', score.id, id)).length}
  <li class="folder-entry" data-folder-id={id} style:--depth={Math.min(depth, 3)}>
    <div class="tree-row">
      <button class="disclosure" disabled={!!search.trim() && navigation.current !== 'trash'} aria-label={$t('Déplier ou replier « {title} »', { title: folder.data.name })} aria-expanded={!!opened} onclick={() => toggle(id)}>{#if opened}<ChevronDown size={17}/>{:else}<ChevronRight size={17}/>{/if}</button>
      {#if section === 'library'}
        <button class="folder-select" class:current={navigation.current === id} aria-current={navigation.current === id ? 'location' : undefined} title={organization.path(id)} onclick={() => select(id)}><Folder size={17}/><span>{folder.data.name}</span><span class="count" aria-label={$t('{count} partitions dans ce dossier et ses sous-dossiers', { count })}>{count}</span></button>
      {:else}<span class="folder-title" title={organization.path(id)}><Folder size={17}/><span>{folder.data.name}</span></span>{/if}
      <button class="more" aria-label={$t('Actions pour « {title} »', { title: folder.data.name })} aria-expanded={menu?.kind === 'folder' && menu.id === id} onclick={() => menu = menu?.kind === 'folder' && menu.id === id ? null : { kind: 'folder', id }}><MoreHorizontal size={18}/></button>
    </div>
    {#if menu?.kind === 'folder' && menu.id === id}{@render actions({ kind: 'folder', id }, section)}{/if}
    {#if opened}
      <ul>
        {#each folder.children.filter(child => section === 'trash' || visibleFolders.has(child)) as child (child)}{@render folderRow(child, depth + 1, section)}{/each}
        {#each folderFiles(id, section) as file (file.id)}{@render fileRow(file, depth + 1, section)}{/each}
      </ul>
    {/if}
  </li>
{/snippet}

<div class="library-tree" bind:this={tree}>
  <div class="tree-toolbar"><button class="root-select" class:current={navigation.current === 'all'} aria-current={navigation.current === 'all' ? 'location' : undefined} onclick={() => select('all')}>{$t('Racine de la bibliothèque')} <span>{active.length}</span></button><button class="create-folder" aria-label={$t('Créer un dossier')} disabled={blocked || working || navigation.current === 'trash'} onclick={beginCreate}><FolderPlus size={19}/></button></div>
  <p class="current-path">{$t('Dossier courant : {path}', { path: navigation.current === 'trash' ? $t('Corbeille') : navigation.current === 'unfiled' ? $t('Non classés') : organization.path(navigation.current) || $t('Racine de la bibliothèque') })}</p>
  <p class="sr-only" role="status">{$t(notice)}</p>
  <nav aria-label={$t('Bibliothèque personnelle')}>
    {#if navigation.current !== 'trash'}
      <ul>
        {#each organization.roots.filter(id => visibleFolders.has(id)) as id (id)}{@render folderRow(id, 0, 'library')}{/each}
        <li class="unfiled-entry">
          <div class="tree-row"><button class="disclosure" disabled={!!search.trim() && navigation.current !== 'trash'} aria-label={$t('Déplier ou replier « {title} »', { title: $t('Non classés') })} aria-expanded={!!search.trim() || navigation.expanded.includes('unfiled')} onclick={() => toggle('unfiled')}>{#if search.trim() || navigation.expanded.includes('unfiled')}<ChevronDown size={17}/>{:else}<ChevronRight size={17}/>{/if}</button><button class="folder-select" class:current={navigation.current === 'unfiled'} aria-current={navigation.current === 'unfiled' ? 'location' : undefined} onclick={() => select('unfiled')}>{$t('Non classés')} <span class="count">{active.filter(score => organization.matches('score', score.id, 'unfiled')).length}</span></button></div>
          {#if search.trim() || navigation.expanded.includes('unfiled')}<ul>{#each folderFiles(null, 'library') as file (file.id)}{@render fileRow(file, 1, 'library')}{/each}</ul>{/if}
        </li>
      </ul>
      {#if search.trim() && !matching.length && !visibleFolders.size}<p>{$t('Aucune partition dans cette sélection.')}</p>{/if}
      {#if !active.length && !destinations.length}<p>{$t('Ajoutez un morceau du catalogue public ou importez votre partition.')}</p>{/if}
    {/if}
    <button class="trash-select" class:current={navigation.current === 'trash'} aria-current={navigation.current === 'trash' ? 'location' : undefined} onclick={() => select('trash')}><Trash2 size={17}/>{$t('Corbeille')} <span>{$t('{count} éléments', { count: trash.length })}</span></button>
    {#if navigation.current === 'trash'}
      <p>{$t('Les éléments restent conservés jusqu’à leur suppression définitive.')}</p>
      <button class="empty-trash" disabled={blocked || working || !trash.length} onclick={() => removing = 'all'}>{$t('Vider la corbeille')}</button>
      {#if !roots.length}<p>{$t('La corbeille est vide.')}</p>{/if}
      <ul class="trash-list">{#each roots as item (`${item.kind}:${item.id}`)}{#if item.kind === 'folder'}{@render folderRow(item.id, 0, 'trash')}{:else}{@const file = files.find(file => file.kind === item.kind && file.id === item.id)}{#if file}{@render fileRow(file, 0, 'trash')}{/if}{/if}{/each}</ul>
    {/if}
  </nav>
</div>
{#if editing}
  <LibraryDialog label={$t(editing.mode === 'create' ? 'Créer un dossier' : 'Renommer le dossier')} onclose={() => editing = null}>
    <form onsubmit={save}><label for="folder-name">{$t('Nom du dossier')}</label><input id="folder-name" maxlength="100" required bind:value={name} disabled={blocked || working}/><div class="dialog-actions"><button type="submit" disabled={blocked || working || !name.trim()}>{$t('Enregistrer le dossier')}</button><button type="button" onclick={() => editing = null}>{$t('Annuler')}</button></div></form>
  </LibraryDialog>
{/if}
{#if removing !== null}
  <LibraryDialog label={$t(removing === 'all' ? 'Vider la corbeille' : 'Supprimer définitivement')} onclose={() => removing = null}>
    <form onsubmit={purge}><p>{$t('Dossiers : {folders} · Partitions : {scores} · Essais : {takes}', losses)}</p><p>{$t('Les XML personnels, leurs réglages et les WAV concernés seront perdus. Cette action est irréversible.')}</p><div class="dialog-actions"><button type="button" onclick={() => removing = null}>{$t('Annuler')}</button><button type="submit" disabled={blocked || working || !contents.length}>{$t('Confirmer la suppression définitive')}</button></div></form>
  </LibraryDialog>
{/if}
<style>
  .library-tree { min-width:0;margin:12px 0 24px; } ul { list-style:none;padding:0;margin:0; } li { min-width:0; } .tree-row { display:flex;align-items:center;min-width:0;padding-left:calc(var(--depth, 0) * 10px);border-bottom:1px solid var(--line); }
  button { min-height:44px;min-width:44px;font-size:12px; } .disclosure,.more,.create-folder { width:44px;flex-shrink:0;display:flex;justify-content:center;align-items:center; }
  .folder-select,.file-open,.folder-title,.file-title { display:flex;gap:6px;align-items:center;flex:1;min-width:0;text-align:left;padding:8px 4px; }
  .folder-select>span:first-of-type,.folder-title>span,.file-title>span,.file-open>span { flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
  strong,small { display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; } strong { font-size:12px;font-weight:550; } small { font-size:11px;color:var(--subtle);margin-top:3px; }
  .file-open { padding-left:10px; }.file-title { min-height:44px;padding-left:10px; }.count { flex:0!important;font-size:11px;color:var(--subtle); }
  .current,.chosen { background:var(--accent-soft);color:var(--accent);border-radius:6px; }.tree-toolbar { display:flex;align-items:center; }.root-select { flex:1;min-width:0;text-align:left;padding:8px; }.root-select span { float:right; }
  p { font-size:12px;line-height:1.6;color:var(--subtle);padding:9px 4px; }.current-path { overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }.row-actions { display:flex;flex-wrap:wrap;gap:6px;padding:8px;background:var(--paper); }.row-actions button,.empty-trash { border:1px solid var(--line);border-radius:6px;padding:8px 10px; }
  .trash-select { display:flex;width:100%;gap:8px;align-items:center;margin-top:12px;border-top:1px solid var(--line);padding:8px; }.trash-select span { margin-left:auto;font-size:11px;color:var(--subtle); }.empty-trash { margin:5px 0 12px; }
</style>
