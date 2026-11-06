<script lang="ts">
  import { t, translate } from './i18n';
  import { Folder } from '@lucide/svelte';
  import { moveItem, storageScope } from './storage';
  import { folderFor, type Organization } from './organization';
  let { organization, kind, id, title, onerror, blocked = false }: { organization:Organization; kind:'score'|'take'; id:string; title:string; onerror:(message:string)=>void; blocked?:boolean } = $props();
  let working = $state(false);
  async function move(event:Event) {
    const select = event.currentTarget as HTMLSelectElement, value = select.value, scope = storageScope();
    working = true;
    try { await moveItem(kind, id, value || null, scope); }
    catch(cause) { select.value = folderFor(organization,kind,id) || ''; onerror(cause instanceof Error ? translate(cause.message) : translate("Impossible de déplacer cet élément.")); }
    finally { working = false; }
  }
</script>
<label class="item-folder"><Folder size={12} /><select aria-label={$t('Dossier de {title}', { title })} value={folderFor(organization,kind,id) || ''} disabled={blocked || working} onchange={event => void move(event)}><option value="">{$t("Non classé")}</option>{#each organization.destinations() as folder}<option value={folder.id}>{organization.path(folder.id)}</option>{/each}</select></label>
<style>
  .item-folder { display:flex;align-items:center;gap:5px;min-width:0;color:var(--subtle); } .item-folder :global(svg) { flex-shrink:0; } select { font-size:11px;padding:4px 5px;border:0;background:transparent;color:var(--subtle);min-width:0;max-width:100%;width:100%; }
</style>
