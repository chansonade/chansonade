import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Generate only the checked-in public catalogue. User scores, accounts and
// recordings never enter this build or its pages.
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const rawBase = process.env.CHANSONADE_BASE_PATH || '/';
if (!rawBase.startsWith('/') || rawBase.startsWith('//') || /[?#\\]/.test(rawBase) || rawBase.split('/').includes('..')) {
  throw new Error('CHANSONADE_BASE_PATH must be an absolute URL path.');
}
const base = `${rawBase.replace(/\/+$/, '')}/`;
const catalogue = `${base}catalogue/`;
const entries = JSON.parse(await readFile(path.join(root, 'public/scores/catalog.json'), 'utf8'));
const groups = [
  ['children-fr', 'Comptines en français', 'fr'],
  ['children-en', 'Comptines en anglais', 'en'],
  ['children-de', 'Comptines en allemand', 'de'],
  ['children-nl', 'Comptines en néerlandais', 'nl'],
  ['classics', 'Classiques', null],
];
const text = {
  fr: { all: 'Tous les dossiers', catalogue: 'Catalogue public', sing: 'Chanter ce morceau', download: 'Télécharger la partition', source: 'Source', viewSource: 'Consulter la source', license: 'Licence', credits: 'Crédits', details: 'Informations', language: 'Langue', level: 'Niveau', range: 'Tessiture', application: 'Ouvrir Chansonade', clientSource: 'Code source du client', notices: 'Licences et crédits', description: title => `Partition de « ${title} » : chant, piano, téléchargement, source et licence.`, languages: { fr: 'Français', en: 'Anglais', de: 'Allemand', nl: 'Néerlandais', la: 'Latin' }, levels: { beginner: 'Débutant', easy: 'Facile', intermediate: 'Intermédiaire', advanced: 'Avancé', 'premiers pas': 'Premiers pas', 'intermédiaire': 'Intermédiaire' }, notes: ['Do', 'Do♯', 'Ré', 'Ré♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'] },
  en: { all: 'All folders', catalogue: 'Public catalogue', sing: 'Sing this piece', download: 'Download the score', source: 'Source', viewSource: 'View the source', license: 'License', credits: 'Credits', details: 'Information', language: 'Language', level: 'Level', range: 'Vocal range', application: 'Open Chansonade', clientSource: 'Client source code', notices: 'Licenses and credits', description: title => `Score for “${title}”: singing, piano, download, source and license.`, languages: { fr: 'French', en: 'English', de: 'German', nl: 'Dutch', la: 'Latin' }, levels: { beginner: 'Beginner', easy: 'Easy', intermediate: 'Intermediate', advanced: 'Advanced', 'premiers pas': 'First steps', 'intermédiaire': 'Intermediate' }, notes: ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] },
  de: { all: 'Alle Ordner', catalogue: 'Öffentlicher Katalog', sing: 'Dieses Stück singen', download: 'Noten herunterladen', source: 'Quelle', viewSource: 'Quelle ansehen', license: 'Lizenz', credits: 'Mitwirkende und Herkunft', details: 'Informationen', language: 'Sprache', level: 'Schwierigkeitsgrad', range: 'Stimmumfang', application: 'Chansonade öffnen', clientSource: 'Quellcode des Clients', notices: 'Lizenzen und Herkunft', description: title => `Noten für „${title}“: Gesang, Klavier, Download, Quelle und Lizenz.`, languages: { fr: 'Französisch', en: 'Englisch', de: 'Deutsch', nl: 'Niederländisch', la: 'Latein' }, levels: { beginner: 'Anfänger', easy: 'Leicht', intermediate: 'Mittel', advanced: 'Fortgeschritten', 'premiers pas': 'Erste Schritte', 'intermédiaire': 'Mittel' }, notes: ['C', 'Cis', 'D', 'Dis', 'E', 'F', 'Fis', 'G', 'Gis', 'A', 'B', 'H'] },
  nl: { all: 'Alle mappen', catalogue: 'Openbare catalogus', sing: 'Dit lied zingen', download: 'Bladmuziek downloaden', source: 'Bron', viewSource: 'Bron bekijken', license: 'Licentie', credits: 'Makers en herkomst', details: 'Informatie', language: 'Taal', level: 'Niveau', range: 'Stembereik', application: 'Chansonade openen', clientSource: 'Broncode van de client', notices: 'Licenties en herkomst', description: title => `Bladmuziek voor ‘${title}’: zang, piano, download, bron en licentie.`, languages: { fr: 'Frans', en: 'Engels', de: 'Duits', nl: 'Nederlands', la: 'Latijn' }, levels: { beginner: 'Beginner', easy: 'Eenvoudig', intermediate: 'Gemiddeld', advanced: 'Gevorderd', 'premiers pas': 'Eerste stappen', 'intermédiaire': 'Gemiddeld' }, notes: ['C', 'Cis', 'D', 'Dis', 'E', 'F', 'Fis', 'G', 'Gis', 'A', 'Ais', 'B'] },
};
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const slug = entry => entry.file.replace(/\.(musicxml|mxl)$/, '');
const href = entry => `${catalogue}${slug(entry)}/`;
const language = entry => entry.language.toLowerCase().split('-')[0];
const level = (entry, labels) => labels.levels[entry.level.toLowerCase()] || entry.level;
const note = (midi, labels) => `${labels.notes[midi % 12]}${Math.floor(midi / 12) - 1}`;

if (!Array.isArray(entries)) throw new Error('The public catalogue must be an array.');
const ids = new Set(), files = new Set();
for (const entry of entries) {
  if (!entry || typeof entry !== 'object' || !/^[a-f0-9]{64}$/.test(entry.id) || typeof entry.file !== 'string' || !/^[a-z0-9][a-z0-9.-]*\.(musicxml|mxl)$/.test(entry.file) || ids.has(entry.id) || files.has(entry.file)) throw new Error('Invalid or duplicated public catalogue identity.');
  const group = groups.find(([id]) => id === entry.group);
  if (!group) throw new Error(`Unknown public catalogue group: ${entry.group}`);
  for (const field of ['title', 'composer', 'language', 'level', 'license', 'credits']) {
    if (typeof entry[field] !== 'string' || !entry[field].trim()) throw new Error(`Missing ${field}: ${entry.file}`);
  }
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(entry.language) || (group[2] && language(entry) !== group[2])) throw new Error(`Inconsistent score language: ${entry.file}`);
  for (const field of ['sourceUrl', 'licenseUrl']) {
    if (typeof entry[field] !== 'string' || new URL(entry[field]).protocol !== 'https:') throw new Error(`Invalid ${field}: ${entry.file}`);
  }
  if ((entry.minMidi === undefined) !== (entry.maxMidi === undefined) || (entry.minMidi !== undefined && (!Number.isInteger(entry.minMidi) || !Number.isInteger(entry.maxMidi) || entry.minMidi < 0 || entry.maxMidi > 127 || entry.minMidi > entry.maxMidi))) throw new Error(`Invalid vocal range: ${entry.file}`);
  ids.add(entry.id); files.add(entry.file);
  // Vite must have copied this allowlisted public file before generating pages.
  await access(path.join(dist, 'scores', entry.file));
}
for (const [group] of groups) {
  if (entries.filter(entry => entry.group === group).length < 3) throw new Error(`The public catalogue needs at least three scores in ${group}.`);
}
await access(path.join(dist, 'fonts/fonts.css'));

const css = `
:root { color-scheme: light dark; font-family: 'DM Sans', sans-serif; --paper:#fff; --background:#f5f6f8; --ink:#172746; --muted:#52627a; --line:#dce2eb; --accent:#2858d6; }
* { box-sizing:border-box; }
body { margin:0; background:var(--background); color:var(--ink); line-height:1.65; }
a { color:var(--accent); text-underline-offset:3px; }
a:focus-visible { outline:3px solid var(--accent); outline-offset:4px; }
.wrap { max-width:1000px; margin:auto; padding:0 24px; }
header { border-bottom:1px solid var(--line); background:var(--paper); }
header .wrap { min-height:64px; display:flex; align-items:center; justify-content:space-between; gap:16px; }
.brand { display:inline-flex; align-items:center; gap:9px; text-decoration:none; color:var(--ink); font-weight:650; font-size:20px; letter-spacing:-.5px; }
.beta { font-size:11px; font-weight:500; line-height:1.3; padding:3px 6px; border:1px solid var(--line); border-radius:5px; letter-spacing:0; }
header .back { font-size:13px; padding:8px 0; }
main { padding-top:36px; padding-bottom:48px; }
h1 { font-size:clamp(27px,5vw,39px); line-height:1.2; letter-spacing:-.8px; margin:0 0 12px; overflow-wrap:anywhere; }
h2 { font-size:21px; line-height:1.4; margin:0 0 13px; }
h3 { font-size:17px; line-height:1.45; margin:0; font-weight:600; }
p { margin:0 0 16px; }
.intro, .composer { color:var(--muted); }
.folders { display:flex; flex-wrap:wrap; gap:6px 18px; margin:24px 0 30px; }
.folders a { padding:7px 0; font-size:14px; }
.group { margin-top:32px; scroll-margin-top:20px; }
.scores { list-style:none; margin:0; padding:0; border-top:1px solid var(--line); }
.scores li { padding:15px 0; border-bottom:1px solid var(--line); }
.scores h3 a { display:inline-block; padding:2px 0; }
.scores p { font-size:13px; color:var(--muted); margin:4px 0 0; }
.trail { display:flex; flex-wrap:wrap; gap:6px 18px; font-size:13px; margin:0 0 24px; }
.actions { display:flex; flex-wrap:wrap; align-items:center; gap:12px; margin:27px 0; }
.actions a { display:inline-flex; align-items:center; min-height:44px; padding:9px 15px; border:1px solid var(--line); border-radius:7px; background:var(--paper); text-decoration:none; font-size:15px; }
.actions .primary { background:#2858d6; border-color:#2858d6; color:#fff; font-weight:600; }
.details, .credits { border-top:1px solid var(--line); padding-top:24px; margin-top:30px; }
dl { display:grid; grid-template-columns:max-content minmax(0,1fr); gap:7px 24px; margin:0; }
dt { color:var(--muted); } dd { margin:0; overflow-wrap:anywhere; }
.credit-text { white-space:pre-line; overflow-wrap:anywhere; }
footer { border-top:1px solid var(--line); padding:20px 0; font-size:12px; }
footer .wrap { display:flex; flex-wrap:wrap; gap:9px 20px; }
.skip { position:absolute; left:12px; top:-100px; padding:9px 14px; background:var(--paper); z-index:1; }
.skip:focus { top:8px; }
@media (prefers-color-scheme:dark) { :root { --paper:#182336; --background:#131b2a; --ink:#e5edf9; --muted:#b3c0d4; --line:#33435b; --accent:#97baff; } }
@media (max-width:480px) { .wrap { padding-inline:18px; } header .wrap { min-height:60px; gap:12px; } header .back { font-size:12px; } .brand { font-size:18px; } main { padding-top:27px; } dl { grid-template-columns:1fr; gap:2px; } dd { margin-bottom:10px; } .actions { align-items:stretch; flex-direction:column; } .actions a { justify-content:center; } }
`;

function document({ title, description, locale = 'fr', body }) {
  const labels = text[locale] || text.fr;
  const skip = { fr: 'Aller au contenu', en: 'Skip to content', de: 'Zum Inhalt', nl: 'Naar de inhoud' }[locale] || 'Aller au contenu';
  return `<!doctype html>
<html lang="${escape(locale)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escape(description)}">
  <title>${escape(title)} · Chansonade</title>
  <link rel="stylesheet" href="${escape(`${base}fonts/fonts.css`)}">
  <link rel="icon" href="${escape(`${base}logo.png`)}" type="image/png">
  <style>${css}</style>
</head>
<body>
  <a class="skip" href="#content">${escape(skip)}</a>
  <header><div class="wrap"><a class="brand" href="${escape(catalogue)}">Chansonade <span class="beta" lang="fr">Bêta</span></a><a class="back" href="${escape(base)}">${escape(labels.application)}</a></div></header>
  <main class="wrap" id="content">${body}</main>
  <footer><div class="wrap"><a href="${escape(catalogue)}">${escape(labels.all)}</a><a href="${escape(`${base}legal/THIRD_PARTY.md`)}">${escape(labels.notices)}</a><a href="${escape(`${base}source/chansonade-source.tar.gz`)}">${escape(labels.clientSource)}</a></div></footer>
</body>
</html>
`;
}

const sections = groups.map(([id, title]) => `<section class="group" id="${id}" aria-labelledby="heading-${id}"><h2 id="heading-${id}">${escape(title)}</h2><ul class="scores">${entries.filter(entry => entry.group === id).map(entry => `<li><h3><a href="${escape(href(entry))}" lang="${escape(entry.language)}">${escape(entry.title)}</a></h3><p>${escape(entry.composer)} · ${escape(level(entry, text.fr))}</p></li>`).join('\n')}</ul></section>`).join('\n');
const index = document({ title: 'Catalogue public de partitions', description: 'Partitions pour chant et piano : comptines en français, anglais, allemand et néerlandais, et morceaux classiques. Sources, crédits et licences par morceau.', body: `<h1>Catalogue public</h1><p class="intro">Partitions pour chanter et jouer au piano, accessibles sans compte.</p><nav class="folders" aria-label="Dossiers du catalogue">${groups.map(([id, title]) => `<a href="#${id}">${escape(title)}</a>`).join('')}</nav>${sections}` });
const output = path.join(dist, 'catalogue');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'index.html'), index);
for (const entry of entries) {
  const labels = text[language(entry)] || text.fr;
  const locale = text[language(entry)] ? language(entry) : 'fr';
  const range = entry.minMidi === undefined ? '' : `<dt>${escape(labels.range)}</dt><dd>${escape(note(entry.minMidi, labels))} – ${escape(note(entry.maxMidi, labels))}</dd>`;
  const format = entry.file.endsWith('.mxl') ? 'MXL' : 'MusicXML';
  const page = document({ title: entry.title, description: labels.description(entry.title), locale, body: `<nav class="trail" aria-label="${escape(labels.catalogue)}"><a href="${escape(catalogue)}">${escape(labels.all)}</a><a lang="fr" href="${escape(`${catalogue}#${entry.group}`)}">${escape(groups.find(([id]) => id === entry.group)[1])}</a></nav><h1 lang="${escape(entry.language)}">${escape(entry.title)}</h1><p class="composer">${escape(entry.composer)}</p><div class="actions"><a class="primary" href="${escape(`${base}?score=${entry.id}`)}">${escape(labels.sing)}</a><a href="${escape(`${base}scores/${entry.file}`)}" download="${escape(entry.file)}">${escape(labels.download)} (${format})</a></div><section class="details" aria-labelledby="details-title"><h2 id="details-title">${escape(labels.details)}</h2><dl><dt>${escape(labels.language)}</dt><dd>${escape(labels.languages[language(entry)] || entry.language)}</dd><dt>${escape(labels.level)}</dt><dd>${escape(level(entry, labels))}</dd>${range}</dl></section><section class="credits" aria-labelledby="credits-title"><h2 id="credits-title">${escape(labels.credits)}</h2><p class="credit-text" lang="en">${escape(entry.credits)}</p><dl><dt>${escape(labels.source)}</dt><dd><a href="${escape(entry.sourceUrl)}">${escape(labels.viewSource)}</a></dd><dt>${escape(labels.license)}</dt><dd><a href="${escape(entry.licenseUrl)}">${escape(entry.license)}</a></dd></dl></section>` });
  const directory = path.join(output, slug(entry));
  await mkdir(directory);
  await writeFile(path.join(directory, 'index.html'), page);
}
console.log(`Catalogue public : ${entries.length} partitions, ${groups.length} dossiers, ${entries.length + 1} pages HTML sans JavaScript (${base}).`);

