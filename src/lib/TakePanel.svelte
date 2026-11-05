<script lang="ts">
  import { t, translate, locale, formatDate } from './i18n';
  import { onMount } from 'svelte';
  import { X, Play, Download, Trash2, Cloud, HardDrive, LoaderCircle, AudioLines } from '@lucide/svelte';
  import { listTakes, getTake, deleteTake, storageScope, subscribeStorage, type RecordedTake, type TakeSummary } from './storage';
  import { syncState } from './sync';
  import { readOrganization, folderFor, type OrganizationSnapshot } from './storage';
  import FolderControls from './FolderControls.svelte';
  import ItemFolder from './ItemFolder.svelte';
  import { matchesSearch } from './catalog';
  let { onclose, onplay, onexport, onerror, ondiscard, memoryTakes = [], blocked = false }: { onclose: () => void; onplay: (take: RecordedTake) => Promise<void>; onexport: (take: RecordedTake) => void; onerror: (message: string) => void; ondiscard: (id: string) => void; memoryTakes?: RecordedTake[]; blocked?: boolean } = $props();
  let takes = $state<TakeSummary[]>([]);
  let busy = $state('');
  let failure = $state('');
  let revision = 0;
  let armedDelete = $state('');
  let organization = $state<OrganizationSnapshot>({folders:[],placements:{}});
  let selectedFolder = $state('all');
  let search = $state('');
  const visibleTakes = $derived([...memoryTakes.filter(take => !takes.some(stored => stored.id === take.id)).map(take => ({ id: take.id, createdAt: take.createdAt, title: take.title, duration: take.duration, scoreId: take.scoreId, synced: false, pending: false })), ...takes].sort((a,b) => b.createdAt - a.createdAt));
  const filteredTakes = $derived(visibleTakes.filter(take => matchesSearch(search,take.title) && (selectedFolder === 'all' || (folderFor(organization,'take',take.id) || 'unfiled') === selectedFolder)));
  const duration = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
  async function refresh() {
    const request = ++revision, scope = storageScope();
    try { const [next,folders] = await Promise.all([listTakes(scope),readOrganization(scope)]); if (request === revision && scope === storageScope()) { takes = next; organization = folders; } }
    catch { failure = 'Impossible de lire les enregistrements de cet appareil.'; }
  }
  async function action(id: string, kind: 'play' | 'export' | 'delete') {
    if (busy || blocked) return;
    if (kind === 'delete' && armedDelete !== id) { armedDelete = id; return; }
    busy = id; failure = '';
    const scope = storageScope();
    try {
      if (kind === 'delete') { await deleteTake(id, scope); ondiscard(id); armedDelete = ''; }
      else {
        const take = memoryTakes.find(take => take.id === id) || await getTake(id, scope);
        if (scope !== storageScope()) return;
        if (!take) throw new Error('Cet essai n’est plus disponible.');
        if (kind === 'play') { await onplay(take); onclose(); } else onexport(take);
      }
    } catch (cause) { failure = cause instanceof Error ? cause.message : 'Impossible d’ouvrir cet essai.'; onerror(translate(failure)); }
    finally { busy = ''; }
  }
  onMount(() => { void refresh(); const stop = subscribeStorage(event => { if (event.reason === 'scope') { takes = []; organization = {folders:[],placements:{}}; selectedFolder = 'all'; search = ''; armedDelete = ''; failure = ''; } void refresh(); }); return () => { revision++; stop(); }; });
</script>

<button class="drawer-backdrop" aria-label={$t("Fermer les enregistrements")} onclick={onclose}></button>
<aside class="take-panel" aria-label={$t("Enregistrements")}>
  <div class="panel-heading"><AudioLines size={20} /><h2>{$t("Enregistrements")}</h2><button class="icon-button" aria-label={$t("Fermer les enregistrements")} onclick={onclose}><X size={20} /></button></div>
  <p class="explanation">{$t("Réécoutez un essai avec sa partition et sa courbe de hauteur.")}</p>
  <p class="sync-note">{#if $syncState.user}<Cloud size={15} /> {$t('Synchronisation automatique avec votre compte.')}{:else}<HardDrive size={15} /> {$t('Conservés sur cet appareil. Connectez-vous pour les synchroniser.')}{/if}</p>
  {#if $syncState.user && $syncState.message}<p class="failure" role="status">{$t($syncState.message)}</p>{/if}
  {#each $syncState.failures.filter(item => item.kind === 'take') as item}
    <p class="failure">{$t('Essai « {title} » : {message}', { title: item.title, message: $t(item.message) })}</p>
  {/each}
  {#if failure}<p class="failure" role="alert">{$t(failure)}</p>{/if}
  <input class="take-search" type="search" aria-label={$t("Rechercher un essai")} placeholder={$t("Rechercher un essai")} bind:value={search} />
  <FolderControls {organization} bind:selected={selectedFolder} onrefresh={refresh} {onerror} {blocked} />
  {#if !visibleTakes.length}<p class="empty">{$t("Aucun essai enregistré. Utilisez « Enregistrer » pour commencer.")}</p>{/if}
  {#if visibleTakes.length && !filteredTakes.length}<p class="empty">{$t("Aucun essai dans cette sélection.")}</p>{/if}
  <div class="take-list">{#each filteredTakes as take (take.id)}
    <article class="take-card">
      <h3>{take.title}</h3>
      <p><time datetime={new Date(take.createdAt).toISOString()}>{formatDate(take.createdAt, $locale)}</time><span>{duration(take.duration)}</span></p>
      <ItemFolder {organization} kind="take" id={take.id} title={take.title} {onerror} blocked={blocked || memoryTakes.some(item => item.id === take.id)} />
      {#if memoryTakes.some(item => item.id === take.id)}<p class="failure">{$t("En mémoire seulement : exportez cet essai avant de fermer la page.")}</p>{/if}
      <div class="take-controls"><button class="review-play" disabled={!!busy || blocked} onclick={() => void action(take.id, 'play')}>{#if busy === take.id}<LoaderCircle class="spin" size={16} />{:else}<Play size={16} />{/if}{$t('Réécouter')}</button><span class="take-sync" title={take.synced ? $t('Synchronisé avec votre compte') : take.pending ? $t('En attente de synchronisation') : $t('Sur cet appareil')}>{#if take.synced}<Cloud size={15} />{:else}<HardDrive size={15} />{/if}</span><button class="icon-button" disabled={!!busy || blocked} aria-label={$t("Exporter cet essai")} onclick={() => void action(take.id, 'export')}><Download size={17} /></button><button class="delete-button" class:armed={armedDelete === take.id} disabled={!!busy || blocked} aria-label={armedDelete === take.id ? $t('Confirmer la suppression') : $t('Supprimer cet essai')} onclick={() => void action(take.id, 'delete')}><Trash2 size={17} />{#if armedDelete === take.id}<span>{$t("Confirmer")}</span>{/if}</button></div>
    </article>
  {/each}</div>
</aside>

<style>
  .take-panel { position:fixed; inset:0 0 0 auto; z-index:50; width:min(410px,100vw); overflow:auto; background:var(--side); border-left:1px solid var(--line); padding:18px 22px; box-shadow:0 12px 50px #14213b30; }
  .take-search { width:100%;border:1px solid var(--line);border-radius:7px;background:var(--paper);color:var(--ink);padding:10px;font-size:13px; }
  .panel-heading { display:flex; align-items:center; gap:10px; } h2 { font-size:18px; font-weight:650; flex:1; }
  .explanation,.sync-note,.empty { font-size:13px; line-height:1.6; color:var(--subtle); margin:15px 0; } .sync-note { display:flex; gap:8px; align-items:flex-start; } .sync-note :global(svg) { flex-shrink:0; margin-top:3px; }
  .take-list { display:flex; flex-direction:column; gap:13px; margin-top:22px; } .take-card { border:1px solid var(--line); border-radius:9px; background:var(--paper); padding:15px; } h3 { font-size:14px; font-weight:600; margin:0 0 9px; overflow-wrap:anywhere; }
  .take-card p { display:flex; justify-content:space-between; gap:8px; color:var(--subtle); font-size:12px; } .take-controls { display:flex; align-items:center; gap:4px; margin-top:13px; } .review-play { min-height:38px; display:flex; align-items:center; gap:7px; padding:7px 10px; border-radius:6px; color:var(--accent); background:var(--accent-soft); font-size:13px; }
  .take-sync { margin-left:auto; color:var(--subtle); display:flex; align-items:center; } .delete-button { display:flex; align-items:center; justify-content:center; min-height:38px; min-width:32px; gap:5px; border-radius:6px; font-size:12px; } .armed,.failure { color:var(--coral); } .failure { font-size:13px; line-height:1.5; }
</style>
