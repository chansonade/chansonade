import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/organization.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { projectOrganization, folderFor } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const folder = (id, parentId, trashedAt) => ({ id, data: { type: 'folder', name: id, added: 1,
  ...(parentId === undefined ? {} : { parentId }), ...(trashedAt === undefined ? {} : { trashedAt }) } });
const placement = (id, folderId, trashedAt) => ({ type: 'placement', itemKind: 'score', itemId: id, folderId,
  ...(trashedAt === undefined ? {} : { trashedAt }) });
const flat = projectOrganization({ folders: [folder('b'), folder('a')], placements: { 'score:x': placement('x', 'b') } });
assert.deepEqual(flat.roots, ['a', 'b']);
assert.equal(flat.path('b'), 'b');
assert.equal(folderFor(flat, 'score', 'x'), 'b');
assert.equal(flat.classify('take', 'unplaced').state, 'unfiled');

const snapshot = {
  folders: [folder('b', 'a'), folder('a', 'b', 0), folder('c', 'b'), folder('d', 'missing'), folder('e', 'd'), folder('self', 'self')],
  placements: { 'score:x': placement('x', 'c'), 'score:y': placement('y', 'e'), 'score:z': placement('z', 'missing', 0), 'score:missing': placement('missing', 'a') },
};
const items = ['x', 'y', 'z', 'unplaced'].map(id => ({ kind: 'score', id }));
const before = JSON.stringify(snapshot);
const summarize = value => ({ folders: value.folders, roots: value.roots, trash: value.trash(items),
  locations: items.map(item => value.classify(item.kind, item.id)), destinations: value.destinations().map(folder => folder.id) });
const projected = projectOrganization(snapshot);
assert.equal(JSON.stringify(snapshot), before, 'Projection must never repair its input');
assert.equal(projected.folder('a').parentId, null, 'Cut the smallest ID, regardless of arrival order');
assert.equal(projected.folder('self').parentId, null);
assert.equal(projected.folder('d').parentId, null);
assert.equal(projected.path('c'), 'a / b / c');
assert.equal(projected.path('e'), 'd / e');
assert.equal(projected.classify('score', 'x').state, 'trash');
assert.equal(projected.classify('score', 'x').explicitlyTrashed, false);
assert.equal(projected.classify('score', 'z').explicitlyTrashed, true);
assert.equal(projected.classify('score', 'y').state, 'folder');
assert.equal(projected.matches('score', 'y', 'd'), true, 'Folder filtering includes descendants');
assert.equal(projected.matches('score', 'y', 'unfiled'), false);
assert.equal(projected.matches('score', 'unplaced', 'unfiled'), true);
assert.equal(projected.matches('score', 'x'), false);
assert.equal(projected.matches('score', 'z', 'unfiled'), false);
assert.equal(folderFor(projected, 'score', 'x'), null, 'Trash is never inherited by a new take');
assert.deepEqual(projected.destinations('d').map(folder => folder.id), ['self']);
assert.deepEqual(projected.trash([...items].reverse()), projected.trash(items), 'Inventory order does not change the projected trash');
assert.equal(projected.trash(items).length, 5, 'Three folders and two existing files, without a ghost placement');
assert.deepEqual(projected.trashRoots(items), [{ kind: 'folder', id: 'a' }, { kind: 'score', id: 'z' }]);
assert.deepEqual(projected.trashContents(items, { kind: 'folder', id: 'a' }), [{ kind: 'folder', id: 'a' }, { kind: 'folder', id: 'b' }, { kind: 'folder', id: 'c' }, { kind: 'score', id: 'x' }]);
assert.deepEqual(projected.trashContents(items, { kind: 'score', id: 'y' }), []);
for (let rotation = 0; rotation < snapshot.folders.length; rotation++) {
  const rotated = [...snapshot.folders.slice(rotation), ...snapshot.folders.slice(0, rotation)];
  for (const folders of [rotated, [...rotated].reverse()]) {
    const reordered = { ...snapshot, folders, placements: Object.fromEntries(Object.entries(snapshot.placements).reverse()) };
    assert.deepEqual(summarize(projectOrganization(reordered)), summarize(projected));
  }
}
const restored = projectOrganization({ ...snapshot, folders: snapshot.folders.map(item => item.id === 'a' ? folder('a', null, null) : item) });
assert.equal(restored.matches('score', 'x'), true);
assert.equal(restored.matches('score', 'z'), false, 'An explicit item marker survives ancestor restoration');
const independentFolder = projectOrganization({ ...snapshot, folders: restored.folders.map(item => ({ id: item.id, data: item.id === 'c' ? { ...item.data, trashedAt: 1 } : item.data })) });
assert.equal(independentFolder.classify('score', 'x').state, 'trash', 'An explicit descendant folder remains trashed after restoring an ancestor');
const lateParent = projectOrganization({ ...snapshot, folders: [...snapshot.folders, folder('missing', null, 1)] });
assert.equal(lateParent.folder('d').trashed, true);
assert.equal(lateParent.classify('score', 'y').state, 'trash');

const deep = projectOrganization({ folders: Array.from({ length: 4000 }, (_, index) => folder(String(index), index ? String(index - 1) : null)), placements: {} });
assert.equal(deep.folders.length, 4000);
assert.equal(deep.contains('0', '3999'), true);
assert.equal(deep.path('3999').split(' / ').length, 4000, 'Deep trees do not recurse through the JS stack');
console.log('PASS organization: legacy folders, deterministic cycles/order, missing parents, paths/subtrees, explicit/inherited trash, destinations and deep trees');
