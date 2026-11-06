export type FolderData = { type: 'folder'; name: string; added: number; parentId?: string | null; trashedAt?: number | null };
export type ItemKind = 'score' | 'take';
export type PlacementData = { type: 'placement'; itemKind: ItemKind; itemId: string; folderId: string | null; trashedAt?: number | null };
export type OrganizationItem = { kind: ItemKind; id: string };
export type OrganizationTarget = { kind: 'folder' | ItemKind; id: string };
export type OrganizationSnapshot = {
  folders: { id: string; data: FolderData }[];
  placements: Record<string, PlacementData>;
};
export type OrganizationFolder = {
  id: string; data: FolderData; parentId: string | null; children: string[]; trashed: boolean;
};
export type ItemLocation = { state: 'folder' | 'unfiled' | 'trash'; folderId: string | null; explicitlyTrashed: boolean };
export type Organization = ReturnType<typeof projectOrganization>;

/** The only interpretation of missing parents, cycles and inherited trash. Never repairs storage. */
export function projectOrganization(snapshot: OrganizationSnapshot = { folders: [], placements: {} }) {
  const nodes = new Map<string, OrganizationFolder>();
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  for (const { id, data } of [...snapshot.folders].sort((a, b) => a.data.added - b.data.added || compare(a.id, b.id))) {
    nodes.set(id, { id, data, parentId: data.parentId ?? null, children: [], trashed: false });
  }
  for (const node of nodes.values()) if (!node.parentId || !nodes.has(node.parentId)) node.parentId = null;
  const visited = new Set<string>();
  for (const start of nodes.keys()) {
    const path: string[] = [], positions = new Map<string, number>();
    let id: string | null = start;
    while (id !== null && !visited.has(id)) {
      const cycle = positions.get(id);
      if (cycle !== undefined) {
        const first = path.slice(cycle).sort(compare)[0];
        nodes.get(first)!.parentId = null;
        break;
      }
      positions.set(id, path.length); path.push(id); id = nodes.get(id)!.parentId;
    }
    for (const member of path) visited.add(member);
  }
  const roots: string[] = [];
  for (const node of nodes.values()) {
    if (node.parentId === null) roots.push(node.id);
    else nodes.get(node.parentId)!.children.push(node.id);
  }
  const folders: OrganizationFolder[] = [], stack = [...roots].reverse();
  while (stack.length) {
    const node = nodes.get(stack.pop()!)!;
    node.trashed = node.data.trashedAt != null || (node.parentId !== null && nodes.get(node.parentId)!.trashed);
    folders.push(node);
    for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index]);
  }
  function contains(ancestor: string, id: string | null): boolean {
    while (id !== null) {
      if (id === ancestor) return nodes.has(id);
      id = nodes.get(id)?.parentId ?? null;
    }
    return false;
  }
  function path(id: string): string {
    const names: string[] = [];
    let node = nodes.get(id);
    while (node) { names.push(node.data.name); node = node.parentId === null ? undefined : nodes.get(node.parentId); }
    return names.reverse().join(' / ');
  }
  function classify(kind: ItemKind, id: string): ItemLocation {
    const placement = snapshot.placements[`${kind}:${id}`];
    const folder = placement?.folderId ? nodes.get(placement.folderId) : undefined;
    const explicitlyTrashed = placement?.trashedAt != null;
    return { state: explicitlyTrashed || folder?.trashed ? 'trash' : folder ? 'folder' : 'unfiled', folderId: folder?.id ?? null, explicitlyTrashed };
  }
  function matches(kind: ItemKind, id: string, selection = 'all'): boolean {
    const location = classify(kind, id);
    if (location.state === 'trash') return false;
    return selection === 'all' || (selection === 'unfiled' ? location.state === 'unfiled' : contains(selection, location.folderId));
  }
  /** Inventory comes from the caller; classifying an ID never requires its file. */
  function trash(items: readonly OrganizationItem[]): OrganizationTarget[] {
    return [
      ...folders.filter(folder => folder.trashed).map(folder => ({ kind: 'folder' as const, id: folder.id })),
      ...items.filter(item => classify(item.kind, item.id).state === 'trash')
        .sort((a, b) => compare(`${a.kind}:${a.id}`, `${b.kind}:${b.id}`)),
    ];
  }
  function trashContents(items: readonly OrganizationItem[], selection: OrganizationTarget | 'all'): OrganizationTarget[] {
    const entries = trash(items);
    if (selection === 'all') return entries;
    if (!entries.some(item => item.kind === selection.kind && item.id === selection.id)) return [];
    return entries.filter(item => item.kind === selection.kind && item.id === selection.id || selection.kind === 'folder'
      && contains(selection.id, item.kind === 'folder' ? item.id : classify(item.kind, item.id).folderId));
  }
  function trashRoots(items: readonly OrganizationItem[]): OrganizationTarget[] {
    return trash(items).filter(item => {
      const parent = item.kind === 'folder' ? nodes.get(item.id)!.parentId : classify(item.kind, item.id).folderId;
      return parent === null || !nodes.get(parent)!.trashed;
    });
  }
  return {
    folders, roots, trash, trashContents, trashRoots, classify, matches, contains, path,
    folder: (id: string) => nodes.get(id),
    destinations: (exclude?: string) => folders.filter(folder => !folder.trashed && (exclude === undefined || !contains(exclude, folder.id))),
  };
}

/** An active folder for future takes, never a trash destination. */
export function folderFor(organization: Organization, kind: ItemKind, id: string): string | null {
  const location = organization.classify(kind, id);
  return location.state === 'folder' ? location.folderId : null;
}
