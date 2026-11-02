import manifest from '../../public/scores/catalog.json';

export type CatalogGroup = 'children-fr'|'children-en'|'children-de'|'children-nl'|'classics';
export type CatalogPiece = { id:string; file:string; title:string; composer:string; subtitle:string; period:string; group:CatalogGroup; language:string; level:string; sourceUrl:string; license:string; licenseUrl:string; credits:string; minMidi?:number; maxMidi?:number };
export const catalogGroups: { id:CatalogGroup; name:string; language:string }[] = [
  {id:'children-fr',name:'Chansons pour enfants · Français',language:'fr'},
  {id:'children-en',name:'Chansons pour enfants · Anglais',language:'en'},
  {id:'children-de',name:'Chansons pour enfants · Allemand',language:'de'},
  {id:'children-nl',name:'Chansons pour enfants · Néerlandais',language:'nl'},
  {id:'classics',name:'Les grands classiques du chant',language:''},
];
export const publicCatalog = manifest as CatalogPiece[];
export function matchesSearch(query:string, ...values:string[]) {
  const normalize = (value:string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();
  return normalize(values.join(' ')).includes(normalize(query.trim()));
}
