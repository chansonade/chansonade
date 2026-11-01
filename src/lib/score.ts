import { unzipSync, strFromU8 } from 'fflate';
import { alignNoteTimings } from './loop';

export type ViewMode = 'vertical' | 'horizontal';
export type Part = {
  id: string;
  name: string;
  channel: number;
  program: number;
  staves: number[];
  volume: number;
  muted: boolean;
  solo: boolean;
  transpose: number;
};
export type MusicalNote = { pitch: number; time: number; duration: number; writtenId: string; staff: number; channel: number };
export type Frame = { time: number; quarter: number; notes: string[]; measure?: string; measureStart?: boolean };
export type StaffNotation = { bottomStep: number | null; keyFifths: number; soundingOffset: number };
export type StaffDescription = { staff: number; channel: number; changes: { elementId: string | null; notation: StaffNotation }[] };
export type TimeAnchor = { time: number; elementId: string; staff: number };
export type MusicalData = { midi: string; frames: Frame[]; notes: Record<string, MusicalNote>; parts: Part[]; tempo: number; duration: number; staffDescriptions: Record<string, StaffDescription>; timeAnchors: TimeAnchor[]; legacyLoopTimes?: { from: number; to: number }[] };
export type ScoreResult = { pages: string[]; musical?: MusicalData };
export type NotePosition = { id: string; time: number; duration: number; pitch: number; staff: number; channel: number; x: number; y: number; width: number; height: number; staffStepPx: number; systemY: number; systemHeight: number; measure: string };
export type MeasurePosition = { id: string; time: number; x: number; y: number; width: number; height: number; number: number; systemId: string };
export type StaffProjection = { measureId: string; systemId: string; staff: number; channel: number; startTime: number; endTime: number; left: number; right: number; bottomY: number; stepPx: number; notation: { fromX: number; value: StaffNotation }[]; anchors: { time: number; x: number }[] };
export type ScoreGeometry = { notes: Map<string, NotePosition>; measures: MeasurePosition[]; staffs: StaffProjection[]; width: number; height: number };

type NotationState = { shape: string; line: number; octave: number; fifths: number; instrument: number };
const defaultNotation = (): NotationState => ({ shape: 'G', line: 2, octave: 0, fifths: 0, instrument: 0 });
function readNotation(element: Element, state: NotationState): NotationState {
  const next = { ...state };
  const direct = (tag: string) => Array.from(element.children).find((child) => child.localName === tag);
  const clef = element.localName === 'clef' ? element : direct('clef');
  const shape = clef?.getAttribute('shape') || element.getAttribute('clef.shape');
  if (shape) {
    next.shape = shape;
    next.line = Number(clef?.getAttribute('line') || element.getAttribute('clef.line') || (shape === 'F' ? 4 : shape === 'C' ? 3 : 2));
    const displacement = Number(clef?.getAttribute('dis') || element.getAttribute('clef.dis') || 0);
    const below = (clef?.getAttribute('dis.place') || element.getAttribute('clef.dis.place')) === 'below';
    next.octave = (displacement === 8 ? 12 : displacement === 15 ? 24 : displacement === 22 ? 36 : 0) * (below ? -1 : 1);
  }
  const key = element.localName === 'keySig' ? element : direct('keySig');
  const signature = key?.getAttribute('sig') || element.getAttribute('key.sig');
  if (signature) next.fifths = signature === '0' ? 0 : Number.parseInt(signature, 10) * (signature.endsWith('f') ? -1 : 1);
  const transposition = element.getAttribute('trans.semi');
  if (transposition !== null) next.instrument = Number(transposition);
  return next;
}
function staffNotation(state: NotationState): StaffNotation {
  const reference = state.shape === 'G' ? 4 * 7 + 4 : state.shape === 'F' ? 3 * 7 + 3 : state.shape === 'C' ? 4 * 7 : null;
  return { bottomStep: reference === null ? null : reference - 2 * (state.line - 1), keyFifths: Number.isFinite(state.fifths) ? state.fifths : 0, soundingOffset: state.instrument + state.octave };
}

export const examples = [
  { file: 'une-souris-verte-chant-piano.musicxml', title: 'Une souris verte', subtitle: 'Chant & piano · exercice de justesse', composer: 'Traditionnel · arrangement Chansonade', period: '' },
  ...(import.meta.env.DEV && import.meta.env.VITE_LOCAL_SCORES === 'true' ? [
  { file: 'vecchia-zimarra-senti.mxl', title: 'Vecchia zimarra', subtitle: 'La Bohème · Colline', composer: 'Giacomo Puccini', period: '1896' },
  { file: 'ideale-francesco-paolo-tosti.mxl', title: 'Ideale', subtitle: 'Mélodie pour voix et piano', composer: 'Francesco Paolo Tosti', period: '1882' },
  { file: 'se-vuol-ballare-le-nozze-di-figaro-wa-mozart-piano.mxl', title: 'Se vuol ballare', subtitle: 'Les Noces de Figaro · Figaro', composer: 'Wolfgang Amadeus Mozart', period: '1786' },
  { file: 'non-piu-andrai-de-mozart-version-pour-baryton-et-piano-avec-les-paroles.mxl', title: 'Non più andrai', subtitle: 'Les Noces de Figaro · Figaro', composer: 'Wolfgang Amadeus Mozart', period: '1786' },
  { file: 'n1-notte-e-giorno-faticar-don-giovanni-wa-mozart-piano.mxl', title: 'Notte e giorno faticar', subtitle: 'Don Giovanni · Leporello', composer: 'Wolfgang Amadeus Mozart', period: '1787' },
  { file: 'la-sonnambula-vi-ravviso-o-luoghi-ameni-bellini.mxl', title: 'Vi ravviso, o luoghi ameni', subtitle: 'La Sonnambula · Rodolfo', composer: 'Vincenzo Bellini', period: '1831' },
  ] : []),
];

export function readMusicXML(bytes: ArrayBuffer): string {
  const array = new Uint8Array(bytes);
  if (array[0] !== 0x50 || array[1] !== 0x4b) return new TextDecoder().decode(array);
  const files = unzipSync(array);
  const container = files['META-INF/container.xml'];
  let path = '';
  if (container) {
    const doc = new DOMParser().parseFromString(strFromU8(container), 'application/xml');
    path = doc.getElementsByTagNameNS('*', 'rootfile')[0]?.getAttribute('full-path') || '';
  }
  path ||= Object.keys(files).find((name) => !name.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(name)) || '';
  if (!files[path]) throw new Error('Le fichier MXL ne contient pas de partition MusicXML.');
  return strFromU8(files[path]);
}

export function metadata(xml: string, filename: string) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Le fichier XML est invalide.');
  if (!['score-partwise', 'score-timewise'].includes(doc.documentElement.localName)) throw new Error('Ce fichier ne contient pas de partition MusicXML.');
  return {
    title: doc.querySelector('work-title')?.textContent || doc.querySelector('movement-title')?.textContent || filename.replace(/\.(musicxml|mxl|xml)$/i, ''),
    composer: doc.querySelector('creator[type="composer"]')?.textContent || 'Partition personnelle',
  };
}

export class Score {
  private worker = new Worker(new URL('./score-worker.ts', import.meta.url), { type: 'module' });
  private nextId = 0;
  private waiting = new Map<number, { resolve: (result: ScoreResult) => void; reject: (error: Error) => void }>();

  constructor() {
    this.worker.onmessage = ({ data }) => {
      const pending = this.waiting.get(data.id);
      if (!pending) return;
      this.waiting.delete(data.id);
      if (data.error) pending.reject(new Error(data.error));
      else pending.resolve({ pages: data.pages, musical: data.musical && this.convertMusic(data.musical) });
    };
    this.worker.onerror = (event) => {
      for (const pending of this.waiting.values()) pending.reject(new Error(event.message || 'Le moteur de partition ne répond pas.'));
      this.waiting.clear();
    };
  }

  load(xml: string, mode: ViewMode, width: number, zoom: number) { return this.request({ type: 'load', xml, mode, width, zoom }); }
  layout(mode: ViewMode, width: number, zoom: number) { return this.request({ type: 'layout', mode, width, zoom }); }
  destroy() { this.worker.terminate(); for (const pending of this.waiting.values()) pending.reject(new Error('Lecteur fermé.')); this.waiting.clear(); }

  private request(payload: object): Promise<ScoreResult> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.worker.postMessage({ ...payload, id });
    });
  }

  private convertMusic(data: any): MusicalData {
    const legacyLoopTimes = alignNoteTimings(data.notes, data.timemap);
    const doc = new DOMParser().parseFromString(data.mei, 'application/xml');
    const staffChannels = new Map<number, number>();
    const partsByChannel = new Map<number, Part>();
    for (const staffDef of doc.querySelector('scoreDef')?.querySelectorAll('staffDef') || []) {
      const staff = Number(staffDef.getAttribute('n'));
      let parent: Element | null = staffDef;
      let instrument: Element | null = null;
      let label = '';
      while (parent && parent.localName !== 'scoreDef') {
        instrument ||= Array.from(parent.children).find((el) => el.localName === 'instrDef') || null;
        label ||= Array.from(parent.children).find((el) => el.localName === 'label')?.textContent || '';
        if (instrument) break;
        parent = parent.parentElement;
      }
      const channel = Number(instrument?.getAttribute('midi.channel') ?? (staff - 1));
      staffChannels.set(staff, channel);
      const part = partsByChannel.get(channel);
      if (part) part.staves.push(staff);
      else partsByChannel.set(channel, { id: `part-${channel}`, name: label || (Number(instrument?.getAttribute('midi.instrnum') || 0) === 0 ? 'Piano' : `Partie ${partsByChannel.size + 1}`), channel, program: Number(instrument?.getAttribute('midi.instrnum') || 0), staves: [staff], volume: 100, muted: false, solo: false, transpose: 0 });
    }
    const staffByNote = new Map<string, number>();
    for (const note of doc.querySelectorAll('note')) {
      const id = note.getAttribute('xml:id');
      if (id) staffByNote.set(id, Number(note.closest('staff')?.getAttribute('n') || 1));
    }
    for (const note of Object.values(data.notes) as MusicalNote[]) {
      note.staff = staffByNote.get(note.writtenId) || 1;
      note.channel = staffChannels.get(note.staff) ?? 0;
    }
    const staffDescriptions: Record<string, StaffDescription> = {};
    const notationStates = new Map<number, NotationState>();
    const visit = (element: Element) => {
      if (element.localName === 'scoreDef') {
        for (const [staff, state] of notationStates) notationStates.set(staff, readNotation(element, state));
        for (const definition of element.querySelectorAll('staffDef')) {
          const staff = Number(definition.getAttribute('n'));
          notationStates.set(staff, readNotation(definition, readNotation(element, notationStates.get(staff) || defaultNotation())));
        }
        return;
      }
      if (element.localName === 'staff' && element.closest('measure')) {
        const staff = Number(element.getAttribute('n'));
        let state = notationStates.get(staff) || defaultNotation();
        const changes: StaffDescription['changes'] = [{ elementId: null, notation: staffNotation(state) }];
        for (const change of element.querySelectorAll('clef, keySig')) {
          state = readNotation(change, state);
          changes.push({ elementId: change.getAttribute('xml:id'), notation: staffNotation(state) });
        }
        notationStates.set(staff, state);
        const id = element.getAttribute('xml:id');
        if (id) staffDescriptions[id] = { staff, channel: staffChannels.get(staff) ?? 0, changes };
        return;
      }
      for (const child of element.children) visit(child);
    };
    const score = doc.querySelector('score');
    if (score) visit(score);
    const staffByElement = new Map<string, number>();
    for (const element of doc.querySelectorAll('note, rest, mRest')) {
      const id = element.getAttribute('xml:id');
      if (id) staffByElement.set(id, Number(element.closest('staff')?.getAttribute('n') || 1));
    }
    const timeAnchors: TimeAnchor[] = [];
    for (const event of data.timemap) {
      for (const id of [...(event.on || []), ...(event.restsOn || [])]) {
        const elementId = data.notes[id]?.writtenId || id.replace(/-rend\d+$/, '');
        const staff = staffByElement.get(elementId);
        if (staff !== undefined) timeAnchors.push({ time: event.tstamp / 1000, elementId, staff });
      }
    }
    const active = new Set<string>();
    let measure: string | undefined;
    const frames: Frame[] = data.timemap.map((event: any) => {
      for (const id of event.off || []) active.delete(id);
      for (const id of event.on || []) active.add(id);
      if (event.measureOn) measure = event.measureOn.replace(/-rend\d+$/, '');
      return { time: event.tstamp / 1000, quarter: event.qstamp, notes: [...active], measure, measureStart: !!event.measureOn };
    });
    return { midi: data.midi, frames, notes: data.notes, parts: [...partsByChannel.values()], tempo: data.timemap.find((event: any) => event.tempo)?.tempo || 120, duration: frames.at(-1)?.time || 0, staffDescriptions, timeAnchors, legacyLoopTimes };
  }
}

// All DOM geometry is sampled once after layout, never during animation.
export function indexGeometry(content: HTMLElement, music: MusicalData): ScoreGeometry {
  const origin = content.getBoundingClientRect();
  const notes = new Map<string, NotePosition>();
  const rect = (element: Element) => {
    const box = element.getBoundingClientRect();
    return { x: box.left - origin.left, y: box.top - origin.top, width: box.width, height: box.height };
  };
  const elements = new Map(Array.from(content.querySelectorAll<SVGGraphicsElement>('[id]')).map((el) => [el.id, el]));
  const staffSteps = new Map<Element, number>();
  for (const [id, note] of Object.entries(music.notes)) {
    const element = elements.get(note.writtenId);
    if (!element) continue;
    const head = element.querySelector('.notehead') || element;
    const box = rect(head);
    const staff = element.closest('.staff');
    let staffStepPx = staff && staffSteps.get(staff);
    if (staff && !staffStepPx) {
      const lines = staff.querySelectorAll(':scope > path');
      if (lines.length >= 2) {
        // Adjacent diatonic notes are half an interline apart. The notehead
        // glyph is slightly taller than an interline and varies by note type.
        staffStepPx = Math.abs(rect(lines[1]).y - rect(lines[0]).y) / 2;
        if (staffStepPx > 0) staffSteps.set(staff, staffStepPx);
      }
    }
    const system = element.closest('.system');
    const systemBox = system ? rect(system) : box;
    notes.set(id, { id: note.writtenId, time: note.time / 1000, duration: note.duration / 1000, pitch: note.pitch, channel: note.channel, staff: note.staff, x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width, height: box.height, staffStepPx: staffStepPx || box.height / 2, systemY: systemBox.y, systemHeight: systemBox.height, measure: element.closest('.measure')?.id || '' });
  }
  const measures: MeasurePosition[] = [];
  let previous = '';
  const numbers = new Map<string, number>();
  for (const frame of music.frames) {
    if (!frame.measure || (frame.measure === previous && !frame.measureStart)) continue;
    previous = frame.measure;
    const element = elements.get(frame.measure);
    if (!element) continue;
    const number = numbers.get(frame.measure) || numbers.size + 1;
    numbers.set(frame.measure, number);
    // Spanners (ties, lyrics, tempo annotations) may extend beyond the measure.
    // Staff lines provide the actual left/right boundaries used for the camera.
    const staffLine = element.querySelector(':scope > .staff > path');
    const measureBox = rect(staffLine || element);
    const system = element.closest('.system');
    const systemBox = system ? rect(system) : rect(element);
    measures.push({ id: frame.measure, time: frame.time, x: measureBox.x, width: measureBox.width, y: systemBox.y, height: systemBox.height, number, systemId: system?.id || frame.measure });
  }
  const staffs: StaffProjection[] = [];
  const anchorsByStaff = new Map<number, TimeAnchor[]>();
  for (const anchor of music.timeAnchors) {
    const list = anchorsByStaff.get(anchor.staff) || [];
    list.push(anchor);
    anchorsByStaff.set(anchor.staff, list);
  }
  for (let index = 0; index < measures.length; index++) {
    const measure = measures[index];
    const endTime = measures[index + 1]?.time || music.duration;
    const measureElement = elements.get(measure.id);
    if (!measureElement) continue;
    for (const staff of measureElement.querySelectorAll<SVGGraphicsElement>(':scope > .staff')) {
      const description = music.staffDescriptions[staff.id];
      const lines = staff.querySelectorAll(':scope > path');
      if (!description || lines.length < 2) continue;
      const top = rect(lines[0]), bottom = rect(lines[lines.length - 1]);
      const stepPx = Math.abs(bottom.y - top.y) / (lines.length - 1) / 2;
      if (!stepPx) continue;
      const anchors = (anchorsByStaff.get(description.staff) || []).filter((anchor) => anchor.time >= measure.time && anchor.time < endTime).flatMap((anchor) => {
        const element = elements.get(anchor.elementId);
        if (!element || element.closest('.measure')?.id !== measure.id) return [];
        const box = rect(element.querySelector('.notehead') || element.querySelector('use') || element);
        return [{ time: anchor.time, x: box.x + box.width / 2 }];
      }).sort((a, b) => a.time - b.time || a.x - b.x);
      const unique = anchors.filter((anchor, i) => i === 0 || anchor.time !== anchors[i - 1].time);
      if (!unique.length || unique[0].time > measure.time) unique.unshift({ time: measure.time, x: top.x });
      // Accidentals and simultaneous voices can share an onset. Keep a single
      // increasing time-to-x map instead of restarting inside each note glyph.
      for (let i = 1; i < unique.length; i++) unique[i].x = Math.max(unique[i - 1].x, unique[i].x);
      staffs.push({ measureId: measure.id, systemId: measure.systemId, staff: description.staff, channel: description.channel, startTime: measure.time, endTime, left: top.x, right: top.x + top.width, bottomY: bottom.y, stepPx, notation: description.changes.map((change) => ({ fromX: change.elementId && elements.has(change.elementId) ? rect(elements.get(change.elementId)!).x : top.x, value: change.notation })).sort((a, b) => a.fromX - b.fromX), anchors: unique });
    }
  }
  for (const staff of staffs) {
    const next = staffs.find((candidate) => candidate.staff === staff.staff && candidate.startTime === staff.endTime);
    staff.anchors.push({ time: staff.endTime, x: next?.systemId === staff.systemId ? Math.max(staff.anchors.at(-1)!.x, next.anchors[0].x) : Math.max(staff.anchors.at(-1)!.x, staff.right) });
  }
  return { notes, measures, staffs, width: content.scrollWidth, height: content.scrollHeight };
}

export function frameAt(frames: Frame[], time: number): Frame | undefined {
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (frames[mid].time <= time) lo = mid;
    else hi = mid - 1;
  }
  return frames[lo];
}

export function measureAt(measures: MeasurePosition[], time: number) {
  let i = 0;
  while (i + 1 < measures.length && measures[i + 1].time <= time) i++;
  return { current: measures[i], next: measures[i + 1] };
}
