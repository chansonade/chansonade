<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { Play, Pause, RotateCcw, SkipBack, SkipForward, Repeat2, Mic, MicOff, Maximize2, Minimize2, PanelLeft, Library, Upload, ChevronRight, ChevronDown, X, Plus, Minus, SlidersHorizontal, ArrowRight, ArrowDown, Music2, Piano, Crosshair, Check, Volume2, VolumeX, Download, CircleHelp, LoaderCircle, Circle, Square, UserRound, MoreHorizontal, AudioLines } from '@lucide/svelte';
  import { Score, examples, readMusicXML, metadata, indexGeometry, frameAt, measureAt, type MusicalData, type ScoreGeometry, type ViewMode, type Part, type NotePosition } from './lib/score';
  import { AudioPlayer } from './lib/audio';
  import PianoKeyboard from './lib/PianoKeyboard.svelte';
  import AccountPanel from './lib/AccountPanel.svelte';
  import ThemeToggle from './lib/ThemeToggle.svelte';
  import RepositoryLink from './lib/RepositoryLink.svelte';
  import Brand from './lib/Brand.svelte';
  import LanguagePicker from './lib/LanguagePicker.svelte';
  import { MAX_SCORE_ARCHIVE_BYTES, checkScoreMetadata } from './lib/score-import';
  import { t, locale, noteName } from './lib/i18n';
  import TakePanel from './lib/TakePanel.svelte';
  import { takeMoment, takePitchSamples, takePitchCount, takeTraceStarts } from './lib/take-playback';
  import FolderControls from './lib/FolderControls.svelte';
  import ItemFolder from './lib/ItemFolder.svelte';
  import { publicCatalog, catalogGroups, matchesSearch, type CatalogPiece, type CatalogGroup } from './lib/catalog';
  import { readOrganization, folderFor, moveItem, type OrganizationSnapshot } from './lib/storage';
  import { measuresInLoop, canonicalLoopBounds } from './lib/loop';
  import { syncState, startSync, setTakeSyncPaused } from './lib/sync';
  import { PitchInput, type PitchResult, type RecordingEndReason } from './lib/pitch';
  import { projectPitchTrace, type PitchSample } from './lib/projection';
  import { CaptureTimeline } from './lib/timeline';
  import { finishCapturedTake, takeArchive, TakeMetadataBudget, type TakeCapture } from './lib/take-session';
  import { requestPersistentStorage } from './lib/storage-health';
  import { savedScores, saveScore, scoreId, readSettings, writeSettings, storageScope, subscribeStorage, listTakes, latestTake as loadLatestTake, type SavedScore, type RecordedTake, type TakePitch, type TakeTransport } from './lib/storage';

  let engine: Score;
  const audio = new AudioPlayer();
  let pitch: PitchInput;
  let viewport: HTMLDivElement;
  let content: HTMLDivElement;
  let cursor: HTMLDivElement;
  let fileInput: HTMLInputElement;
  let app: HTMLDivElement;
  let music = $state<MusicalData | null>(null);
  let geometry = $state<ScoreGeometry | null>(null);
  let pages = $state<string[]>([]);
  let title = $state('Ouvrir une partition');
  let composer = $state('');
  let subtitle = $state('');
  let currentId = $state('');
  let currentXML = '';
  let documentScope = storageScope();
  let libraryScope = storageScope();
  let libraryRequest: Promise<[SavedScore[], OrganizationSnapshot]> | null = null;
  let practiceDirty = false;
  let practiceTouched = false;
  let documentStarted = false;
  let defaultParts: Part[] = [];
  let pendingAccountOpening = $state.raw<Opening | null>(null);
  const initialTokens = new URLSearchParams(window.location.hash.slice(1));
  const initialInvitation = initialTokens.get('invitation') || '';
  const initialReset = initialTokens.get('reset') || '';
  const requestedCatalogId = new URLSearchParams(window.location.search).get('score');
  const catalogueURL = import.meta.env.VITE_CATALOGUE_URL || '';
  let invitation = $state(initialInvitation);
  let resetToken = $state(initialReset);
  let accountOpen = $state(!!initialInvitation || !!initialReset);
  if (initialInvitation || initialReset) history.replaceState(null, '', `${location.pathname}${location.search}`);
  let customScores = $state<SavedScore[]>([]);
  let organization = $state<OrganizationSnapshot>({folders:[],placements:{}});
  let libraryTab = $state<'personal'|'public'>('public');
  let libraryTabChosen = false;
  let libraryFolder = $state('all');
  let librarySearch = $state('');
  let catalogGroup = $state<CatalogGroup>('children-fr');
  let addingPublic = $state(false);
  const filteredScores = $derived(customScores.filter(score => matchesSearch(librarySearch,score.title,score.composer) && (libraryFolder === 'all' || (folderFor(organization,'score',score.id) || 'unfiled') === libraryFolder)));
  const filteredPublic = $derived(publicCatalog.filter(piece => piece.group === catalogGroup && matchesSearch(librarySearch,piece.title,piece.composer)));
  const currentPublicPiece = $derived(publicCatalog.find(piece => piece.id === currentId));
  let libraryOpen = $state(false);
  let mixerOpen = $state(false);
  let takesOpen = $state(false);
  let helpOpen = $state(false);
  let keyboardOpen = $state(false);
  let pianoMode = $state(false);
  let preference = $state<'auto' | ViewMode>('auto');
  let viewportWidth = $state(900);
  let viewportHeight = $state(500);
  let mobileLandscape = $state(window.innerWidth < 950 && window.innerWidth > window.innerHeight);
  let mobile = $state(window.innerWidth < 950);
  const mode = $derived(preference === 'auto' ? (mobileLandscape ? 'horizontal' : 'vertical') : preference);
  let zoom = $state(1);
  let follow = $state(true);
  let fullscreen = $state(false);
  let controlsVisible = $state(true);
  let busy = $state(false);
  let layoutBusy = $state(false);
  let audioBusy = $state(false);
  let audioReady = $state(false);
  let status = $state('');
  let error = $state('');
  let toast = $state('');
  let playing = $state(false);
  let position = $state(0);
  let duration = $state(0);
  let rate = $state(1);
  let targetChannel = $state(0);
  let parts = $state<Part[]>([]);
  let loopA = $state<number | null>(null);
  let loopB = $state<number | null>(null);
  let loopEnabled = $state(false);
  let loopSelecting = $state<'a' | 'b' | null>(null);
  let loopFirstEnd = 0;
  let pianoFrame = $state<MusicalData['frames'][number] | undefined>(undefined);
  let currentMeasure = $state(1);
  let micActive = $state(false);
  let micBusy = $state(false);
  let microphoneId = $state(localStorage.getItem('chansonade.microphone') || '');
  let microphones = $state<MediaDeviceInfo[]>([]);
  let microphoneLabel = $state('');
  let pitchResult = $state<PitchResult | null>(null);
  let latency = $state(0);
  let pitchSamples = $state<PitchSample[]>([]);
  let pendingPitchSamples = $state<PitchSample[]>([]);
  let traceSince = 0;
  const captureTimeline = new CaptureTimeline();
  let pitchError = $state<number | null>(null);
  let takePhase = $state<'idle' | 'preparing' | 'recording' | 'saving'>('idle');
  let takeSeconds = $state(0);
  let countIn = $state(0);
  let lastTake = $state<RecordedTake | null>(null);
  let memoryTakes = $state<{ scope: string; take: RecordedTake }[]>([]);
  let takeScope = $state(storageScope());
  let replayTake = $state<RecordedTake | null>(null);
  let replayURL = $state('');
  let replayAudio = $state<HTMLAudioElement>();
  let replayPosition = $state(0);
  let replaySamples = $state<PitchSample[]>([]);
  const replayTraceStarts = $derived(takeTraceStarts(replaySamples));
  let replayRequest = 0;
  const replayMoment = $derived(replayTake ? takeMoment(replayTake, replayPosition) : null);
  const replayVisibleSamples = $derived.by(() => {
    if (!replayTake) return [];
    const end = takePitchCount(replaySamples, replayPosition);
    return replaySamples.slice(replayTraceStarts[end - 1] || 0, end);
  });
  let takeCapture: TakeCapture | null = null;
  let takeMetadataBudget: TakeMetadataBudget | null = null;
  let pendingTakeEnd: RecordingEndReason | null = null;
  let takeRequest = 0;
  let takeStop: Promise<void> | null = null;
  let takeOpenedMic = false;
  let lastTakeTransport = 0;
  let selection = $state<NotePosition | null>(null);
  let loopBoxes = $state<{ x: number; y: number; width: number; height: number }[]>([]);
  const programs = [{ value: 0, name: 'Piano' }, { value: 42, name: 'Violoncelle' }, { value: 48, name: 'Cordes' }, { value: 52, name: 'Chœur' }, { value: 53, name: 'Voix' }, { value: 73, name: 'Flûte' }];
  const tempo = $derived(Math.round((music?.tempo || 120) * rate));
  const targetPart = $derived(parts.find((p) => p.channel === targetChannel));
  const displayedFrequency = $derived(replayTake ? replayVisibleSamples.at(-1)?.frequency || 0 : micActive ? pitchResult?.frequency || 0 : 0);
  const detectedPitch = $derived(displayedFrequency > 0 ? 69 + 12 * Math.log2(displayedFrequency / 440) : null);
  const pianoScoreNotes = $derived.by(() => {
    const notes = new Map<number, boolean>();
    const displayedParts = replayTake?.settings.parts || parts;
    const anySolo = displayedParts.some((part) => part.solo);
    for (const id of pianoFrame?.notes || []) {
      const note = music?.notes[id];
      if (!note) continue;
      const part = displayedParts.find((part) => part.channel === note.channel);
      const target = note.channel === (replayMoment?.targetChannel ?? targetChannel);
      if (!target && (!part || part.muted || part.volume === 0 || (anySolo && !part.solo))) continue;
      const midi = note.pitch + (target && replayMoment ? replayMoment.transpose : part?.transpose || 0);
      notes.set(midi, target || notes.get(midi) || false);
    }
    return [...notes].map(([midi, target]) => ({ midi, target }));
  });
  const tracePath = $derived(projectPitchTrace(replayTake ? replayVisibleSamples : pitchSamples, geometry));
  const pendingTracePath = $derived(!replayTake && pendingPitchSamples.length ? projectPitchTrace([...pitchSamples.slice(-1), ...pendingPitchSamples], geometry, true) : '');

  let frameRequest = 0;
  let previousFrame = 0;
  let previousTime = 0;
  let previousMeasure = '';
  let lastUI = 0;
  let smoothedX = 0;
  let smoothedY = 0;
  let renderedSignature = '';
  let renderRevision = 0;
  type ScoreSource =
    | { kind: 'catalog'; example: typeof examples[number] }
    | { kind: 'saved'; score: SavedScore }
    | { kind: 'file'; file: File; folderId: string | null }
    | { kind: 'take'; take: RecordedTake }
    | { kind: 'library'; lastId: string | null; requestedId?: string | null };
  type Opening = { scope: string; source: ScoreSource };
  type DirectScoreSource = Exclude<ScoreSource, { kind: 'library' }>;
  type ScoreDocument = { xml: string; id: string; info: { title: string; composer: string; subtitle?: string } };
  type OpeningSteps<T = void> = Generator<Promise<unknown>, T, unknown>;
  let opening: Opening | null = null;
  let highlighted = new Set<string>();
  let elementIndex = new Map<string, Element>();
  let layoutTimer: ReturnType<typeof setTimeout>;
  let toastTimer: ReturnType<typeof setTimeout>;
  let controlsTimer: ReturnType<typeof setTimeout>;
  let saveTimer: ReturnType<typeof setTimeout>;
  let dragged = false;
  let drag: { x: number; y: number; scrollX: number; scrollY: number } | null = null;
  let disposed = false;

  function timeLabel(value: number) {
    return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
  }
  function noteLabel(midi: number) { return noteName(midi, $locale); }
  function notify(message: string) {
    if (disposed) return;
    toast = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast = '', 4200);
  }
  function showControls() {
    if (disposed) return;
    controlsVisible = true;
    clearTimeout(controlsTimer);
    if (playing) controlsTimer = setTimeout(() => controlsVisible = false, 3200);
  }
  function scheduleSave() {
    practiceDirty = true; practiceTouched = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void savePractice(), 350);
  }
  async function savePractice() {
    clearTimeout(saveTimer);
    if (!practiceDirty || !currentId || !music) return;
    const id = currentId, scope = documentScope;
    const settings = { rate, loopA, loopB, loopEnabled, target: targetChannel, parts: parts.map(({ channel, volume, muted, solo, transpose, program }) => ({ channel, volume, muted, solo, transpose, program })) };
    practiceDirty = false;
    try { await writeSettings(id, settings, scope); }
    catch {
      if (id === currentId && scope === documentScope) practiceDirty = true;
      notify('Les réglages n’ont pas pu être sauvegardés sur cet appareil.');
    }
  }
  function* restorePractice(id: string, scope: string, onlyUntouched = false): OpeningSteps<boolean> {
    const saved = yield* openingWait(readSettings(id, scope).catch(() => null));
    if (id !== currentId || scope !== documentScope) return false;
    if (onlyUntouched && (practiceTouched || documentStarted || playing || takePhase !== 'idle')) return false;
    rate = saved?.rate || 1;
    const restoredLoop = canonicalLoopBounds(saved?.loopA ?? null, saved?.loopB ?? null, music?.legacyLoopTimes);
    loopA = restoredLoop.start;
    loopB = restoredLoop.end;
    loopEnabled = saved?.loopEnabled || false;
    targetChannel = parts.some((p) => p.channel === saved?.target) ? saved!.target : parts[0]?.channel || 0;
    parts = defaultParts.map((p) => ({ ...p, ...saved?.parts.find((s) => s.channel === p.channel) }));
    practiceDirty = false; practiceTouched = false; documentStarted = false;
    return true;
  }
  function hydratePracticeIfUntouched(scope: string) {
    return runOpening(opening, hydratePractice(scope));
  }
  function* hydratePractice(scope: string): OpeningSteps {
    if (!audioReady || busy || scope !== documentScope || scope !== storageScope() || practiceTouched || documentStarted || playing || takePhase !== 'idle') return;
    if (yield* restorePractice(currentId, scope, true)) {
      audio.setRate(rate); applyMix(false); syncLoop(false);
    }
  }

  function isCurrentOpening(request: Opening | null): request is Opening {
    return !!request && request === opening && request.scope === storageScope() && !disposed;
  }
  function* openingWait<T>(operation: Promise<T>): OpeningSteps<T> {
    return (yield operation) as T;
  }
  async function runOpening<T>(request: Opening | null, steps: OpeningSteps<T>): Promise<T | undefined> {
    if (!isCurrentOpening(request)) return;
    let next = steps.next();
    try {
      while (!next.done) {
        const result = await next.value.then(value => ({ value }), cause => ({ cause }));
        if (!isCurrentOpening(request)) return;
        next = 'cause' in result ? steps.throw(result.cause) : steps.next(result.value);
      }
      return next.value;
    } finally {
      // Supersession closes the steps through their finally blocks, without
      // routing cancellation through ordinary save/playback error handlers.
      if (!next.done) steps.return(undefined as T);
    }
  }
  function chooseScore(source: ScoreSource): Promise<void> {
    // The request itself is the generation: reserve it before the first await,
    // including a deferred account switch or the initial library lookup.
    const request = { scope: storageScope(), source };
    opening = request;
    ++renderRevision;
    clearTimeout(layoutTimer);
    layoutBusy = false;
    if (source.kind === 'library' && takePhase !== 'idle') {
      pendingAccountOpening = request;
      return Promise.resolve();
    }
    pendingAccountOpening = null;
    return runOpening(request, openScore(request));
  }
  function* openScore(request: Opening): OpeningSteps {
    busy = true; audioBusy = false; error = '';
    status = 'Préparation de la partition…';
    try {
      const source = yield* resolveScoreSource(request);
      const document = yield* readScoreDocument(source, request.scope);
      yield* installScoreDocument(source, document, request.scope);
      if (source.kind === 'file') yield* saveImportedScore(source, document, request.scope);
      else if (source.kind === 'take') yield* startScoreReplay(source.take);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (isCurrentOpening(request)) { busy = false; audioBusy = false; status = ''; }
    }
  }

  function* resolveScoreSource(request: Opening): OpeningSteps<DirectScoreSource> {
    const { source, scope } = request;
    if (source.kind !== 'library') return source;
    if (documentScope !== scope) {
      const saving = savePractice();
      clearAccountDocument(scope);
      yield* openingWait(saving);
    }
    const scores = yield* openingWait(reloadLibrary(scope));
    const requested = publicCatalog.find(piece => piece.id === source.requestedId);
    const saved = scores.find(score => score.id === source.lastId);
    return requested ? { kind: 'catalog', example: requested }
      : saved ? { kind: 'saved', score: saved }
      : { kind: 'catalog', example: examples.find(example => ('id' in example && example.id === source.lastId) || example.file === source.lastId) || examples[0] };
  }

  function* readScoreDocument(source: DirectScoreSource, scope: string): OpeningSteps<ScoreDocument> {
    if (source.kind === 'saved') return { xml: source.score.xml, id: source.score.id, info: source.score };
    let xml: string, info: ScoreDocument['info'];
    if (source.kind === 'catalog') {
      const response = yield* openingWait(fetch(`${import.meta.env.BASE_URL}scores/${source.example.file}`));
      if (!response.ok) throw new Error('Impossible de charger cette partition.');
      xml = readMusicXML(yield* openingWait(response.arrayBuffer()));
      info = source.example;
    } else if (source.kind === 'file') {
      void requestPersistentStorage();
      if (source.file.size > MAX_SCORE_ARCHIVE_BYTES) throw new Error('L’archive MXL dépasse la limite de 10 Mio.');
      xml = readMusicXML(yield* openingWait(source.file.arrayBuffer()));
      info = metadata(xml, source.file.name);
      checkScoreMetadata(info);
    } else {
      if (micActive) { pitch.stop(); micActive = false; pitchResult = null; }
      xml = source.take.scoreXML;
      info = { title: source.take.title, composer: metadata(xml, source.take.title).composer, subtitle: 'Partition de l’enregistrement' };
    }
    const id = yield* openingWait(scoreId(xml));
    if (source.kind === 'catalog') {
      // Preserve settings created before catalogue entries used content IDs.
      const saved = yield* openingWait(readSettings(id, scope));
      if (!saved) {
        const legacy = yield* openingWait(readSettings(source.example.file, scope));
        if (legacy) yield* openingWait(writeSettings(id, legacy, scope));
      }
    }
    return { xml, id, info };
  }

  function* installScoreDocument(source: DirectScoreSource, document: ScoreDocument, scope: string): OpeningSteps {
    stopReplay();
    cancelTakePreparation();
    if (takeCapture) yield* openingWait(finishTake());
    yield* openingWait(savePractice());
    audio.pause(); audio.stopPiano(); playing = false;
    const { xml, id, info } = document;
    if (source.kind === 'take' && currentXML === xml) return;
    audioReady = false;
    loopSelecting = null;
    clearPitchTrace(); captureTimeline.reset(); selection = null;
    const requestedSignature = `${mode}:${viewportWidth}:${viewportHeight}:${zoom}`;
    const result = yield* openingWait(engine.load(xml, mode, viewportWidth - 48, zoom));
    music = result.musical!;
    currentXML = xml; currentId = id;
    title = info.title; composer = info.composer;
    subtitle = info.subtitle || 'Partition personnelle';
    defaultParts = music.parts.map(part => ({ ...part }));
    parts = defaultParts.map(part => ({ ...part }));
    duration = music.duration; position = 0; follow = true;
    documentScope = scope;
    yield* restorePractice(id, scope);
    renderedSignature = requestedSignature;
    yield* installPages(result.pages);
    libraryOpen = false; busy = false;
    if (`${mode}:${viewportWidth}:${viewportHeight}:${zoom}` !== requestedSignature) yield* layoutScore(opening);
    audioBusy = true; status = 'Préparation des instruments…';
    yield* openingWait(audio.load(music.midi));
    audio.setRate(rate); applyMix(false); syncLoop(false); audioReady = true;
    yield* hydratePractice(scope);
    duration = audio.duration || music.duration;
    try { localStorage.setItem('chansonade.last', id); } catch { /* Optional preference. */ }
  }

  function* saveImportedScore(source: Extract<ScoreSource, { kind: 'file' }>, document: ScoreDocument, scope: string): OpeningSteps {
    const { id, info, xml } = document;
    try {
      yield* openingWait(saveScore({ id, ...info, xml, added: Date.now() }, scope));
      if (source.folderId) yield* openingWait(moveItem('score', id, source.folderId, scope));
      yield* openingWait(reloadLibrary(scope));
    } catch { notify('Partition ouverte. Le navigateur n’a pas pu la conserver.'); }
  }

  function* startScoreReplay(take: RecordedTake): OpeningSteps {
    const replay = ++replayRequest;
    replaySamples = takePitchSamples(take, music!);
    replayPosition = 0; replayURL = URL.createObjectURL(take.audio); replayTake = take;
    selection = null; pendingPitchSamples = []; setFollow(true);
    yield* openingWait(tick());
    if (replay !== replayRequest || !replayAudio) return;
    seekReplay(0);
    try { yield* openingWait(replayAudio.play()); showControls(); }
    catch { notify('Appuyez sur Lecture pour réécouter cet essai.'); }
  }

  async function addPublicPiece(piece:CatalogPiece) {
    if (addingPublic || takePhase !== 'idle') return;
    const scope = storageScope(); addingPublic = true;
    try {
      checkScoreMetadata(piece);
      let xml = currentId === piece.id ? currentXML : '';
      if (!xml) { const response = await fetch(`${import.meta.env.BASE_URL}scores/${piece.file}`); if(!response.ok) throw new Error('Partition indisponible.'); xml = readMusicXML(await response.arrayBuffer()); }
      if (scope !== storageScope()) return;
      if (await scoreId(xml) !== piece.id) throw new Error('La partition ne correspond pas au catalogue.');
      if (!(await savedScores(scope)).some(score => score.id === piece.id)) await saveScore({id:piece.id,title:piece.title,composer:piece.composer,xml,added:Date.now()},scope);
      if (libraryFolder !== 'all' && libraryFolder !== 'unfiled') await moveItem('score',piece.id,libraryFolder,scope);
      await reloadLibrary(scope);
      notify('Partition ajoutée à votre bibliothèque.');
    } catch(cause) { notify(cause instanceof Error ? cause.message : 'Impossible d’ajouter cette partition.'); }
    finally { addingPublic = false; }
  }

  function importFile(file?: File) {
    if (!file) return;
    const folderId = organization.folders.find(folder => folder.id === libraryFolder)?.id || null;
    if (fileInput) fileInput.value = '';
    return chooseScore({ kind: 'file', file, folderId });
  }

  function* installPages(next: string[]): OpeningSteps {
    const revision = renderRevision;
    pages = next;
    geometry = null;
    yield* openingWait(tick());
    if (revision !== renderRevision || !content || !music) return;
    const roots = content.querySelectorAll<SVGSVGElement>('.sheet-page > svg');
    for (const svg of roots) {
      const vb = svg.viewBox.baseVal;
      const fit = mode === 'horizontal' ? Math.min(1.5, Math.max(0.15, (viewport.clientHeight - 32) / vb.height)) : 1;
      const scale = fit * zoom;
      svg.style.width = `${vb.width * scale}px`;
      svg.style.height = `${vb.height * scale}px`;
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', title);
    }
    yield* openingWait(tick());
    if (revision !== renderRevision) return;
    geometry = indexGeometry(content, music);
    if (selection) selection = [...geometry.notes.values()].find((note) => note.id === selection!.id) || null;
    elementIndex = new Map(Array.from(content.querySelectorAll('[id]')).map((el) => [el.id, el]));
    highlighted = new Set();
    buildLoopBoxes();
    updateVisual(replayTake ? position : audioReady ? audio.time : position, 0.016, true);
  }

  $effect(() => {
    const signature = `${mode}:${viewportWidth}:${viewportHeight}:${zoom}`;
    const loaded = !!music;
    if (loaded && signature !== untrack(() => renderedSignature)) {
      clearTimeout(layoutTimer);
      layoutTimer = setTimeout(() => void relayout(), 130);
    }
  });

  function relayout() {
    const request = opening;
    return runOpening(request, layoutScore(request));
  }
  function* layoutScore(request: Opening | null): OpeningSteps {
    if (!music || busy || !viewport) return;
    const revision = ++renderRevision;
    renderedSignature = `${mode}:${viewportWidth}:${viewportHeight}:${zoom}`;
    layoutBusy = true;
    try {
      const result = yield* openingWait(engine.layout(mode, viewportWidth - 48, zoom));
      if (revision !== renderRevision) return;
      yield* installPages(result.pages);
    } catch (cause) { if (revision === renderRevision) notify(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (revision === renderRevision && isCurrentOpening(request)) layoutBusy = false; }
  }

  function updateVisual(time: number, dt: number, instant = false) {
    if (!music || !geometry || !content || !viewport || !cursor) return;
    if (pianoMode) { currentMeasure = measureAt(geometry.measures, time).current?.number || 1; return; }
    const frame = frameAt(music.frames, time);
    const active = new Set((frame?.notes || []).map((id) => music!.notes[id]?.writtenId || id));
    for (const id of highlighted) if (!active.has(id)) elementIndex.get(id)?.classList.remove('playing-note');
    for (const id of active) if (!highlighted.has(id)) elementIndex.get(id)?.classList.add('playing-note');
    highlighted = active;
    const { current, next } = measureAt(geometry.measures, time);
    if (!current) return;
    const inTarget = (frame?.notes || []).map((id) => geometry!.notes.get(id)).find((n) => n?.channel === (replayMoment?.targetChannel ?? targetChannel));
    const note = inTarget || (frame?.notes || []).map((id) => geometry!.notes.get(id)).find(Boolean);
    const endTime = next?.time || duration;
    const progress = Math.max(0, Math.min(1, (time - current.time) / Math.max(0.001, endTime - current.time)));
    const endX = next && next.systemId === current.systemId && next.x > current.x ? next.x : current.x + current.width;
    const smoothPosition = current.x + (endX - current.x) * progress;
    const cursorX = note?.x ?? smoothPosition;
    const systemY = current.y;
    const systemHeight = Math.max(50, current.height);
    cursor.style.transform = `translate3d(${cursorX}px, ${systemY - 6}px, 0)`;
    cursor.style.height = `${systemHeight + 12}px`;
    cursor.style.opacity = '1';
    if (current.id !== previousMeasure && current.x < (geometry.measures.find((m) => m.id === previousMeasure)?.x || 0) && mode === 'horizontal') instant = true;
    previousMeasure = current.id;
    currentMeasure = current.number;
    if (follow) {
      if (mode === 'horizontal') {
        const target = Math.max(0, Math.min(viewport.scrollWidth - viewport.clientWidth, smoothPosition - viewport.clientWidth * 0.28));
        smoothedX = instant ? target : smoothedX + (target - smoothedX) * (1 - Math.exp(-dt / 0.24));
        // Keep the SVG in the browser's native scrolling surface. A fractional
        // translate3d promotes this very wide score to a filtered texture and
        // softens fine notation. Retain the continuous camera position, but
        // paint its scroll offset on whole device pixels.
        const pixels = window.devicePixelRatio || 1;
        viewport.scrollLeft = Math.round(smoothedX * pixels) / pixels;
        viewport.scrollTop = 0;
      } else {
        const target = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight, systemY - viewport.clientHeight * 0.16));
        smoothedY = instant ? target : smoothedY + (target - smoothedY) * (1 - Math.exp(-dt / 0.22));
        viewport.scrollTop = smoothedY;
        viewport.scrollLeft = 0;
      }
    }
  }

  function animate(now: number) {
    const dt = Math.min(0.1, (now - previousFrame) / 1000 || 0.016);
    previousFrame = now;
    const looped = audio.update();
    const replayTime = replayTake && replayAudio ? replayAudio.currentTime : 0;
    const time = replayTake ? Math.min(duration, takeMoment(replayTake, replayTime).scoreTime) : audioReady ? audio.time : position;
    pianoFrame = music ? frameAt(music.frames, time) : undefined;
    playing = replayTake ? !!replayAudio && !replayAudio.paused && !replayAudio.ended : audio.playing;
    if (replayTake && now - lastUI > 30) replayPosition = replayTime;
    if (pitch?.active) captureTimeline.observe(pitch.currentTime, time, rate, playing, looped);
    if (!replayTake && (looped || time < previousTime - 0.08)) clearPitchTrace();
    if (takeCapture && (looped || now - lastTakeTransport >= 100)) {
      takeSeconds = Math.max(0, pitch.currentTime - takeCapture.startedAt);
      addTakeMetadata('transport', { time: takeSeconds, scoreTime: time, playing, rate, targetChannel, transpose: parts.find((p) => p.channel === targetChannel)?.transpose || 0 });
      lastTakeTransport = now;
      if (!countIn && audio.ended) void finishTake();
    }
    if (!layoutBusy && !busy) updateVisual(time, dt, looped || Math.abs(time - previousTime) > 0.6);
    if (now - lastUI > 90) { position = time; lastUI = now; }
    previousTime = time;
    frameRequest = requestAnimationFrame(animate);
  }

  async function togglePlayback() {
    if (replayTake) { await toggleReplay(); return; }
    documentStarted = true;
    if (!audioReady) return;
    try {
      if (audio.playing) audio.pause();
      else { setFollow(true); await audio.play(); }
      playing = audio.playing;
      observeTransport();
      showControls();
    } catch (cause) { notify(cause instanceof Error ? cause.message : String(cause)); }
  }
  function seek(time: number) {
    if (replayTake) stopReplay();
    const backwards = time < position - 0.001;
    audio.seek(time);
    observeTransport(true);
    position = time;
    previousTime = time;
    if (backwards) clearPitchTrace();
    else pendingPitchSamples = [];
    updateVisual(time, 0.016, true);
  }
  function restart() { audio.stop(); setFollow(true); seek(loopEnabled && loopA !== null ? loopA : 0); }
  function setRate(value: number) { rate = Math.max(0.3, Math.min(2, value)); audio.setRate(rate); observeTransport(); scheduleSave(); }
  function setFollow(value: boolean) {
    follow = value;
    smoothedX = viewport?.scrollLeft || 0;
    smoothedY = viewport?.scrollTop || 0;
    if (value) updateVisual(position, 0.016, !playing);
  }
  function chooseMode(value: 'auto' | ViewMode) { pianoMode = false; preference = value; showControls(); }
  function choosePiano() { pianoMode = true; keyboardOpen = false; showControls(); }
  function playPiano(midi: number) { void audio.pianoNoteOn(midi).catch((cause) => notify(cause instanceof Error ? cause.message : 'Le piano est indisponible.')); }
  function applyMix(save = true) {
    const anySolo = parts.some((p) => p.solo);
    for (const part of parts) {
      audio.setVolume(part.channel, part.volume);
      audio.setMuted(part.channel, part.muted || (anySolo && !part.solo));
      audio.setTranspose(part.channel, part.transpose);
      audio.setProgram(part.channel, part.program);
    }
    if (save) scheduleSave();
  }
  function syncLoop(save = true) {
    audio.setLoop(loopEnabled ? loopA : null, loopEnabled ? loopB : null);
    buildLoopBoxes();
    if (save) scheduleSave();
  }
  function buildLoopBoxes() {
    loopBoxes = geometry ? measuresInLoop(geometry.measures, loopA, loopB, duration).map(m => ({ x: m.x, y: m.y - 10, width: m.width, height: m.height + 20 })) : [];
  }
  function startLoopSelection() {
    stopReplay();
    if (loopSelecting) { loopSelecting = null; return; }
    pianoMode = false;
    loopSelecting = 'a';
    showControls();
    notify('Cliquez la première note du passage, puis la dernière.');
  }
  function selectNote(note: NotePosition) {
    selection = note;
    if (loopSelecting === 'a') {
      loopA = note.time;
      loopFirstEnd = note.time + note.duration;
      loopB = null;
      loopEnabled = false;
      loopSelecting = 'b';
      syncLoop();
    } else if (loopSelecting === 'b' && loopA !== null) {
      const first = loopA;
      loopA = Math.min(first, note.time);
      loopB = Math.max(loopFirstEnd, note.time + note.duration, loopA + 0.12);
      loopSelecting = null;
      loopEnabled = true;
      syncLoop();
      seek(loopA);
      notify('Passage prêt à répéter.');
    } else {
      seek(note.time);
      if (!playing) void audio.previewNote(note.channel, note.pitch).catch((cause) => notify(String(cause)));
    }
  }
  function scoreClick(event: MouseEvent) {
    showControls();
    if (dragged || !geometry) return;
    const element = (event.target as Element).closest('.note, .chord');
    if (element) {
      const note = [...geometry.notes.values()].find((n) => n.id === element.id || element.contains(elementIndex.get(n.id) || null));
      if (note) selectNote(note);
    }
  }
  function navigateNote(direction: number) {
    if (!geometry) return;
    const notes = [...geometry.notes.values()].filter((n) => n.channel === targetChannel).sort((a, b) => a.time - b.time);
    const time = audioReady ? audio.time : position;
    const next = direction > 0 ? notes.find((n) => n.time > time + 0.06) : [...notes].reverse().find((n) => n.time < time - 0.06);
    if (next) selectNote(next);
  }
  function pointerDown(event: PointerEvent) {
    dragged = false;
    if (event.pointerType === 'mouse' && event.button === 0) drag = { x: event.clientX, y: event.clientY, scrollX: viewport.scrollLeft, scrollY: viewport.scrollTop };
  }
  function pointerMove(event: PointerEvent) {
    showControls();
    if (!drag || !event.buttons) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 5) {
      dragged = true;
      follow = false;
      viewport.scrollLeft = drag.scrollX - dx;
      viewport.scrollTop = drag.scrollY - dy;
    }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else { libraryOpen = false; await app.requestFullscreen(); }
    } catch { notify('Utilisez le mode paysage pour profiter de toute la largeur.'); }
    showControls();
  }
  async function toggleMic() {
    if (takeCapture) { await finishTake(); return; }
    if (micActive) { pitch.stop(); micActive = false; pitchResult = null; pitchError = null; return; }
    micBusy = true;
    try {
      await pitch.start(audio.context || undefined, microphoneId);
      traceSince = 0; // A newly opened microphone can have a new AudioContext clock.
      micActive = true;
      await refreshMicrophones();
      notify('Micro actif. Un casque aide à isoler votre voix.');
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Le microphone est indisponible.'); }
    finally { micBusy = false; }
  }
  async function refreshMicrophones() {
    try { microphones = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audioinput' && device.deviceId !== 'default' && device.deviceId !== 'communications'); }
    catch { microphones = []; }
    microphoneLabel = pitch.inputInfo?.label || '';
  }
  async function changeMicrophone() {
    localStorage.setItem('chansonade.microphone', microphoneId);
    if (!micActive) return;
    pitch.stop(); micActive = false; pitchResult = null; pitchError = null;
    await toggleMic();
  }
  function addTakeMetadata(kind: 'pitch' | 'transport', point: TakePitch | TakeTransport) {
    const capture = takeCapture;
    if (!capture || !takeMetadataBudget || capture.metadataLimitReached) return;
    if (!takeMetadataBudget.append(point)) {
      capture.metadataLimitReached = true;
      if (takePhase !== 'saving') recordingEnded('limit');
      return;
    }
    if (kind === 'pitch') capture.pitches.push(point as TakePitch);
    else capture.transport.push(point as TakeTransport);
  }
  function observeTransport(discontinuity = false) {
    if (pitch?.active) captureTimeline.observe(pitch.currentTime, audio.time, rate, audio.playing, discontinuity);
    if (takeCapture) addTakeMetadata('transport', { time: Math.max(0, pitch.currentTime - takeCapture.startedAt), scoreTime: audio.time, playing: audio.playing, rate, targetChannel, transpose: targetPart?.transpose || 0 });
  }
  function clearPitchTrace() {
    pitchSamples = [];
    pendingPitchSamples = [];
    traceSince = pitch?.currentTime || 0;
  }
  function locatePitch(result: PitchResult) {
    // The estimator reports the captured window's time, not its arrival time.
    // A seek, pause or tempo edit after capture must not move that observation.
    const moment = captureTimeline.at(result.time - latency / 1000);
    if (!moment || !music) return null;
    const frame = frameAt(music.frames, moment.scoreTime);
    const note = moment.playing && geometry ? frame?.notes.map((id) => geometry!.notes.get(id)).find((n) => n?.channel === targetChannel) : undefined;
    const transpose = parts.find((p) => p.channel === targetChannel)?.transpose || 0;
    const sample: PitchSample = { captureTime: result.time, scoreTime: moment.scoreTime, frequency: result.frequency, targetChannel, staff: targetPart?.staves[0] || 0, transpose, playing: moment.playing, epoch: moment.epoch };
    return { sample, note, transpose };
  }
  function displayPitch(result: PitchResult, context: ReturnType<typeof locatePitch>) {
    pitchResult = result;
    pitchError = result.frequency > 0 && context?.note ? Math.round((69 + 12 * Math.log2(result.frequency / 440) - context.note.pitch - context.transpose) * 100) : null;
  }
  function visibleSample(sample: PitchSample) {
    return sample.captureTime >= traceSince && sample.epoch === captureTimeline.epoch;
  }
  function receivePitch(result: PitchResult) {
    const context = locatePitch(result);
    if (!context) return;
    const { sample, note, transpose } = context;
    if (visibleSample(sample)) displayPitch(result, context);
    if (takeCapture && result.time >= takeCapture.startedAt) {
      addTakeMetadata('pitch', { time: result.time - takeCapture.startedAt, frequency: result.frequency, rawFrequency: result.rawFrequency ?? result.frequency, clarity: result.clarity, rms: result.rms, midi: result.midi, cents: result.cents, scoreTime: sample.scoreTime, expectedPitch: note ? note.pitch + transpose : null, noteId: note?.id || null, targetChannel, playing: sample.playing, staff: sample.staff, transpose: sample.transpose, epoch: sample.epoch });
    }
    if (visibleSample(sample)) pitchSamples.push(sample);
  }
  function receivePreview(results: PitchResult[]) {
    if (disposed) return;
    pendingPitchSamples = results.flatMap((result) => {
      const context = locatePitch(result);
      return context && visibleSample(context.sample) ? [context.sample] : [];
    });
    const latest = results.at(-1);
    if (latest) {
      const context = locatePitch(latest);
      if (context && visibleSample(context.sample)) displayPitch(latest, context);
    }
  }

  function showTake(take: RecordedTake | null) {
    if (disposed) return;
    lastTake = take;
  }
  async function reloadLastTake(scope = storageScope()) {
    const [summary] = await listTakes(scope);
    if (scope !== storageScope() || disposed) return;
    if (lastTake?.id === summary?.id) return;
    const take = summary ? await loadLatestTake(scope) : null;
    if (scope === storageScope()) showTake(take);
  }
  function stopReplay() {
    ++replayRequest;
    if (!replayTake) return;
    replayAudio?.pause();
    replayTake = null; replaySamples = []; replayPosition = 0; playing = false;
    if (replayURL) URL.revokeObjectURL(replayURL);
    replayURL = '';
    clearPitchTrace();
    showControls();
  }
  async function replay(take: RecordedTake) {
    if (takePhase !== 'idle') return;
    return chooseScore({ kind: 'take', take });
  }
  async function toggleReplay() {
    if (!replayTake || !replayAudio) return;
    try {
      if (replayAudio.paused) { setFollow(true); await replayAudio.play(); } else replayAudio.pause();
      playing = !replayAudio.paused; showControls();
    } catch { notify('La réécoute audio n’a pas pu démarrer.'); }
  }
  function seekReplay(time: number) {
    if (!replayTake || !replayAudio) return;
    replayAudio.currentTime = time; replayPosition = time;
    position = Math.min(duration, takeMoment(replayTake, time).scoreTime);
    updateVisual(position, 0.016, true);
  }
  function recordingEnded(reason: RecordingEndReason) {
    if (reason === 'interrupted') { micActive = false; pitchResult = null; pitchError = null; }
    audio.pause();
    if (takeCapture) { void finishTake(reason); return; }
    if (takePhase === 'preparing') { pendingTakeEnd = reason; return; }
    if (reason === 'interrupted') { pitch.stop(); notify('Micro interrompu.'); }
  }
  async function startTake() {
    if (!audioReady || takePhase !== 'idle') return;
    void requestPersistentStorage();
    pendingTakeEnd = null;
    stopReplay();
    const scope = storageScope();
    const request = ++takeRequest;
    takePhase = 'preparing';
    takeOpenedMic = !micActive;
    audio.pause();
    if (audio.time >= duration - 0.05) restart();
    try {
      await audio.context?.resume();
      if (!micActive) { await pitch.start(audio.context || undefined, microphoneId); micActive = true; }
      await refreshMicrophones();
      if (request !== takeRequest) return;
      setFollow(true);
      clearPitchTrace();
      const draft: TakeCapture = { scope, folderId:folderFor(organization,'score',currentId), startedAt: pitch.currentTime, createdAt: Date.now(), scoreId: currentId, title, scoreXML: currentXML, settings: JSON.parse(JSON.stringify({ rate, loopA, loopB, loopEnabled, target: targetChannel, parts })), latencyMs: latency, pitches: [], transport: [] };
      const budget = new TakeMetadataBudget(draft);
      if (!budget.fits) throw new Error('La partition est trop volumineuse pour enregistrer un essai.');
      const start = await pitch.startRecording();
      if (request !== takeRequest) { await pitch.stopRecording().catch(() => {}); return; }
      takeCapture = { ...draft, startedAt: start.startedAt };
      takeMetadataBudget = budget;
      takeSeconds = 0;
      takePhase = 'recording';
      observeTransport();
      if (takePhase !== 'recording') return;
      if (pendingTakeEnd) { const reason = pendingTakeEnd; pendingTakeEnd = null; await finishTake(reason); return; }
      for (let remaining = 3; remaining > 0; remaining--) {
        if (request !== takeRequest) return;
        countIn = remaining;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (request !== takeRequest) return;
      countIn = 0;
      await audio.play();
      observeTransport();
      showControls();
    } catch (cause) {
      if (request !== takeRequest) return;
      if (takeCapture) await finishTake();
      else {
        if (takeOpenedMic || !pitch.active) { pitch.stop(); micActive = false; }
        pendingTakeEnd = null;
        takePhase = 'idle';
      }
      notify(cause instanceof Error ? cause.message : 'Impossible de démarrer l’essai.');
    }
  }
  function cancelTakePreparation() {
    if (takePhase !== 'preparing') return;
    ++takeRequest;
    takePhase = 'idle';
    if (takeOpenedMic) { pitch.stop(); micActive = false; }
  }
  function finishTake(reason?: RecordingEndReason): Promise<void> {
    if (takeStop) return takeStop;
    if (!takeCapture) return Promise.resolve();
    ++takeRequest;
    countIn = 0;
    takePhase = 'saving';
    audio.pause();
    observeTransport();
    const captured = takeCapture;
    takeStop = (async () => {
      try {
        const { take, persisted } = await finishCapturedTake(pitch, captured);
        takeCapture = null;
        if (captured.scope === storageScope()) showTake(take);
        if (persisted) notify(reason === 'limit' ? 'Limite d’enregistrement atteinte : essai enregistré.' : reason === 'interrupted' ? 'Micro interrompu : le son reçu a été enregistré.' : take.analysisComplete ? 'Essai enregistré. Le son et la courbe sont conservés.' : 'Son enregistré. La fin de la courbe n’a pas pu être analysée.');
        else { memoryTakes = [...memoryTakes, { scope: captured.scope, take }]; notify('Essai disponible en mémoire : exportez-le pour le conserver.'); }
      } catch (cause) { notify(cause instanceof Error ? cause.message : 'La sauvegarde de l’essai a échoué.'); }
      finally {
        takeCapture = null;
        takeMetadataBudget = null;
        if (takeOpenedMic || !pitch.active) { pitch.stop(); micActive = false; pitchResult = null; }
        takePhase = 'idle';
        takeStop = null;
        showControls();
      }
    })();
    return takeStop;
  }
  async function exportTake(take = lastTake) {
    if (!take) return;
    const url = URL.createObjectURL(await takeArchive(take));
    const link = document.createElement('a');
    link.href = url; link.download = `chansonade-essai-${new Date(take.createdAt).toISOString().replace(/[:.]/g, '-')}.zip`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportPractice() {
    if (!currentXML) return;
    savePractice();
    const blob = new Blob([currentXML], { type: 'application/vnd.recordare.musicxml+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `${title}.musicxml`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function onKey(event: KeyboardEvent) {
    if ((event.target as HTMLElement)?.closest('input, select, textarea, button') || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Space') { event.preventDefault(); void togglePlayback(); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); navigateNote(1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); navigateNote(-1); }
    else if (event.key.toLowerCase() === 'f') void toggleFullscreen();
    else if (event.key.toLowerCase() === 'l') startLoopSelection();
    else if (event.key === 'Escape') { loopSelecting = null; helpOpen = false; mixerOpen = false; takesOpen = false; accountOpen = false; }
  }

  async function reloadLibrary(scope = storageScope()) {
    const request = Promise.all([savedScores(scope), readOrganization(scope)]);
    libraryRequest = request;
    const [scores,folders] = await request;
    if (!disposed && request === libraryRequest && scope === storageScope()) { customScores = scores; organization = folders; libraryScope = scope; if(!libraryTabChosen && scores.length) libraryTab = 'personal'; }
    return scores;
  }
  function openSavedScore(saved: SavedScore) {
    if (libraryScope !== storageScope()) return;
    return chooseScore({ kind: 'saved', score: saved });
  }
  function clearAccountDocument(scope: string) {
    // Clear the previous account before any storage, network or engraving wait.
    stopReplay(); showTake(null);
    audio.pause(); audio.stopPiano(); playing = false; audioReady = false;
    position = 0; duration = 0; rate = 1; targetChannel = 0; loopA = null; loopB = null; loopEnabled = false; selection = null;
    music = null; pages = []; geometry = null; currentXML = ''; currentId = '';
    title = 'Ouvrir une partition'; composer = ''; subtitle = '';
    documentScope = scope; defaultParts = []; parts = [];
    organization = {folders:[],placements:{}}; libraryFolder = 'all'; librarySearch = ''; libraryTabChosen = false;
    practiceDirty = false; practiceTouched = false; documentStarted = false;
    clearPitchTrace(); captureTimeline.reset();
  }
  $effect(() => { setTakeSyncPaused(takePhase !== 'idle'); });
  $effect(() => {
    if (pendingAccountOpening && takePhase === 'idle') {
      const request = pendingAccountOpening;
      pendingAccountOpening = null;
      void runOpening(request, openScore(request));
    }
  });

  onMount(() => {
    engine = new Score();
    pitch = new PitchInput(receivePitch, receivePreview, recordingEnded);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (takePhase !== 'idle' || memoryTakes.length) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    void refreshMicrophones();
    const devicesChanged = () => void refreshMicrophones();
    navigator.mediaDevices?.addEventListener('devicechange', devicesChanged);
    const observer = new ResizeObserver(() => { viewportWidth = Math.round(viewport.clientWidth); viewportHeight = Math.round(viewport.clientHeight); });
    observer.observe(viewport);
    const resized = () => {
      const nextMobile = window.innerWidth < 950;
      const nextLandscape = nextMobile && window.innerWidth > window.innerHeight;
      if ((nextMobile && !mobile) || (nextLandscape && !mobileLandscape)) { libraryOpen = false; mixerOpen = false; }
      mobile = nextMobile;
      mobileLandscape = nextLandscape;
    };
    const fullscreenChanged = () => { fullscreen = !!document.fullscreenElement; };
    const invitationChanged = () => {
      const tokens = new URLSearchParams(location.hash.slice(1));
      const token = tokens.get('invitation'), reset = tokens.get('reset');
      if (!token && !reset) return;
      invitation = token || ''; resetToken = reset || ''; accountOpen = true;
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    };
    window.addEventListener('hashchange', invitationChanged);
    window.addEventListener('resize', resized);
    document.addEventListener('fullscreenchange', fullscreenChanged);
    window.addEventListener('keydown', onKey);
    frameRequest = requestAnimationFrame(animate);
    const stopStorage = subscribeStorage((event) => {
      if (event.scope !== storageScope()) return;
      if (event.reason === 'scope') {
        stopReplay(); showTake(null); takeScope = event.scope;
        void chooseScore({ kind: 'library', lastId: currentId });
      }
      else {
        void reloadLibrary(event.scope).catch(() => {});
        if (event.reason === 'remote') void hydratePracticeIfUntouched(event.scope);
      }
      void reloadLastTake(event.scope).catch(() => {});
    });
    const stopSync = startSync();
    void reloadLastTake().catch(() => {});
    void chooseScore({ kind: 'library', lastId: localStorage.getItem('chansonade.last'), requestedId: requestedCatalogId });
    if (import.meta.env.PROD && 'serviceWorker' in navigator) void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {});
    return () => {
      disposed = true;
      stopSync(); stopStorage();
      cancelTakePreparation();
      savePractice();
      cancelAnimationFrame(frameRequest);
      clearTimeout(layoutTimer); clearTimeout(toastTimer); clearTimeout(controlsTimer); clearTimeout(saveTimer);
      observer.disconnect(); engine.destroy();
      navigator.mediaDevices?.removeEventListener('devicechange', devicesChanged);
      const saving = takeCapture ? finishTake() : takeStop;
      void (saving || Promise.resolve()).finally(() => { pitch.stop(); void audio.destroy(); });
      stopReplay();
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('hashchange', invitationChanged);
      window.removeEventListener('resize', resized); window.removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', fullscreenChanged);
    };
  });
</script>

<svelte:window onpointerup={() => drag = null} />

<div class="app" class:piano-practice={pianoMode} class:immersive={mobileLandscape || fullscreen} class:quiet={!pianoMode && !controlsVisible && playing} bind:this={app}>
  <input class="sr-only" type="file" accept=".mxl,.musicxml,.xml" bind:this={fileInput} onchange={(e) => void importFile(e.currentTarget.files?.[0])} aria-label={$t("Importer une partition")} />

  <header class="app-header">
    <div class="brand-navigation"><button class="icon-button library-toggle" title={$t("Bibliothèque")} aria-label={$t("Bibliothèque")} aria-expanded={libraryOpen} onclick={() => libraryOpen = !libraryOpen}><PanelLeft size={20} /></button><a href={import.meta.env.BASE_URL} aria-label={$t("Chansonade, accueil")} onclick={event => { if (takePhase !== 'idle') event.preventDefault(); }}><Brand /></a></div>
    <div class="document-title">
      <div class="document-heading"><h1>{music ? title : $t('Ouvrir une partition')}</h1>{#if composer}<p>{composer}</p>{/if}</div>
      <div class="document-meta">
        <span class="score-facts">{$t(pianoMode ? 'Piano' : mode === 'horizontal' ? 'Ruban continu' : 'Partition')} · {$t(geometry?.measures.length === 1 ? '{count} mesure' : '{count} mesures', {count: geometry?.measures.length || '—'})}</span>
        {#if currentPublicPiece}
          <span class="score-credit"><a class="score-source" href={currentPublicPiece.sourceUrl} target="_blank" rel="noopener noreferrer" title={currentPublicPiece.credits}>{$t('Source')}</a> · <a class="score-license" href={currentPublicPiece.licenseUrl} target="_blank" rel="noopener noreferrer">{currentPublicPiece.license === 'CC0-1.0' ? 'CC0' : 'CC BY-SA'}</a></span>
          {#if !customScores.some(score => score.id === currentId)}<button class="add-current-score" disabled={addingPublic || takePhase !== 'idle'} aria-label={$t('Ajouter à mes partitions')} title={$t('Ajouter à mes partitions')} onclick={() => void addPublicPiece(currentPublicPiece!)}><Plus size={13} /><span>{$t('Ajouter à mes partitions')}</span></button>{/if}
        {/if}
      </div>
    </div>
    <div class="header-actions"><RepositoryLink compact /><ThemeToggle compact /><LanguagePicker /><button class="icon-button account-button" aria-label={$t('Compte · {status}', {status: $t($syncState.status)})} title={$t('Compte · {status}', {status: $t($syncState.status)})} disabled={takePhase !== 'idle'} onclick={() => accountOpen = true}><UserRound size={19} /><i class:connected={!!$syncState.user}></i></button><button class="icon-button help-button" title={$t("Aide et raccourcis")} aria-label={$t("Aide et raccourcis")} onclick={() => helpOpen = true}><CircleHelp size={19} /></button></div>
  </header>

  <div class="body-layout">
    {#if libraryOpen}
      <button class="drawer-backdrop" aria-label={$t("Fermer la bibliothèque")} onclick={() => libraryOpen = false}></button>
      <aside class="library-panel">
        <div class="section-heading"><span>{$t("BIBLIOTHÈQUE")}</span><button class="icon-button small" aria-label={$t("Fermer la bibliothèque")} onclick={() => libraryOpen = false}><PanelLeft size={17} /></button></div>
        <div class="library-tabs" aria-label={$t("Bibliothèques")}><button class:active={libraryTab === 'public'} onclick={() => { libraryTab = 'public'; libraryTabChosen = true; }}>{$t("Catalogue public")}</button><button class:active={libraryTab === 'personal'} onclick={() => { libraryTab = 'personal'; libraryTabChosen = true; }}>{$t("Mes partitions")}</button></div>
        <input class="library-search" type="search" aria-label={$t("Rechercher une partition")} placeholder={$t("Rechercher une partition")} bind:value={librarySearch} />
        {#if libraryTab === 'personal'}
          <button class="import-button" onclick={() => fileInput.click()}><Plus size={17} /> {$t("Importer une partition")} <span>XML</span></button>
          <FolderControls {organization} bind:selected={libraryFolder} onrefresh={() => reloadLibrary()} onerror={notify} blocked={takePhase !== 'idle'} />
          <div class="library-label">{$t("MES PARTITIONS")} <span>{filteredScores.length}</span></div>
          {#each filteredScores as saved}
            <div class="saved-piece"><button class="piece" class:chosen={currentId === saved.id} onclick={() => void openSavedScore(saved)}><span class="piece-number"><Music2 size={16} /></span><span class="piece-description"><strong>{saved.title}</strong><small>{saved.composer}</small></span>{#if currentId === saved.id}<span class="piece-dot"></span>{/if}</button><div class="saved-piece-folder"><ItemFolder {organization} kind="score" id={saved.id} title={saved.title} onerror={notify} blocked={takePhase !== 'idle'} /></div></div>
          {/each}
          {#if !filteredScores.length}<p class="library-empty">{customScores.length ? $t('Aucune partition dans cette sélection.') : $t('Ajoutez un morceau du catalogue public ou importez votre partition.')}</p>{/if}
        {:else}
          <label class="catalog-folder-label" for="catalog-folder">{$t("Dossier public")}</label><select id="catalog-folder" aria-label={$t("Dossier public")} bind:value={catalogGroup}>{#each catalogGroups as group}<option value={group.id}>{$t(group.name)}</option>{/each}</select>
          <p class="catalog-description">{$t("Partitions gratuites, prêtes à chanter. Votre pratique et vos essais restent privés.")}</p>
          {#if catalogueURL}<a class="public-catalog-link" href={`${catalogueURL}#${catalogGroup}`} target="_blank" rel="noopener noreferrer">{$t("Ouvrir le catalogue partageable")} <ArrowRight size={13} /></a>{/if}
          <div class="library-label">{$t(catalogGroups.find(group => group.id === catalogGroup)?.name || '')}<span>{filteredPublic.length}</span></div>
          {#each filteredPublic as piece}
            <article class="catalog-piece"><button class="piece" class:chosen={currentId === piece.id} onclick={() => void chooseScore({ kind: 'catalog', example: piece })}><span class="piece-number"><Music2 size={16} /></span><span class="piece-description"><strong>{piece.title}</strong><small>{piece.composer}</small><small>{$t(piece.level)}{#if piece.minMidi !== undefined && piece.maxMidi !== undefined} · {noteLabel(piece.minMidi)}–{noteLabel(piece.maxMidi)}{/if}</small></span>{#if currentId === piece.id}<span class="piece-dot"></span>{/if}</button><div class="catalog-piece-actions"><span>{piece.license === 'CC0-1.0' ? 'CC0' : 'CC BY-SA'}</span><button disabled={addingPublic || takePhase !== 'idle' || customScores.some(score => score.id === piece.id)} onclick={() => void addPublicPiece(piece)}>{#if customScores.some(score => score.id === piece.id)}<Check size={13} /> {$t("Dans ma bibliothèque")}{:else}<Plus size={13} /> {$t("Ajouter à mes partitions")}{/if}</button></div><details class="catalog-credits"><summary>{$t("Source et licence")}</summary><p>{piece.credits} · <a href={piece.sourceUrl} target="_blank" rel="noopener noreferrer">{$t("Source")}</a> · <a href={piece.licenseUrl} target="_blank" rel="noopener noreferrer">{piece.license}</a></p></details></article>
          {/each}
          {#if !filteredPublic.length}<p class="library-empty">{$t("Aucun morceau ne correspond à cette recherche.")}</p>{/if}
        {/if}
        <div class="version-label">CHANSONADE <span>{$t("BÊTA")}</span></div>
      </aside>
    {/if}

    <main class="workspace">
      <div class="score-toolbar">
        <div class="mode-controls"><div class="mode-switch" aria-label={$t("Mode de lecture")}><button class:active={!pianoMode && mode === 'vertical'} onclick={() => chooseMode('vertical')} title={$t("Partition verticale")}><ArrowDown size={15} /><span>{$t("Partition")}</span></button><button class:active={!pianoMode && mode === 'horizontal'} onclick={() => chooseMode('horizontal')} title={$t("Ruban horizontal fluide")}><ArrowRight size={15} /><span>{$t("Ruban")}</span></button><button class:active={pianoMode} aria-pressed={pianoMode} onclick={choosePiano} title={$t("Piano interactif")}><Piano size={15} /><span>{$t("Piano")}</span></button></div><button class="auto-mode" class:active={!pianoMode && preference === 'auto'} onclick={() => chooseMode('auto')} title={$t("Adapter le mode à l’orientation du téléphone")}>{$t("Auto")}</button></div>
        <div class="view-controls">{#if !pianoMode}<details class="reader-options"><summary aria-label={$t("Options de lecture")} title={$t("Options de lecture")}><MoreHorizontal size={19} /></summary><div class="reader-options-panel"><button class="reader-follow" aria-pressed={follow} onclick={() => setFollow(!follow)}><Crosshair size={17} />{follow ? $t('Suivi activé') : $t('Activer le suivi')}</button><div class="zoom-choices"><button class="icon-button" aria-label={$t("Réduire la partition")} disabled={zoom <= 0.6} onclick={() => zoom = Math.max(0.6, +(zoom - 0.1).toFixed(1))}><Minus size={17} /></button><button class="zoom-reset" title={$t("Réinitialiser le zoom")} onclick={() => zoom = 1}>{Math.round(zoom * 100)}%</button><button class="icon-button" aria-label={$t("Agrandir la partition")} disabled={zoom >= 1.8} onclick={() => zoom = Math.min(1.8, +(zoom + 0.1).toFixed(1))}><Plus size={17} /></button></div><button class="reader-help" onclick={() => helpOpen = true}><CircleHelp size={17} />{$t("Aide et raccourcis")}</button></div></details>{/if}{#if !pianoMode}<button class="follow-button" class:active={follow} aria-pressed={follow} title={$t("Suivre la lecture")} onclick={() => setFollow(!follow)}><Crosshair size={16} /><span>{$t("Suivi")}</span></button><div class="toolbar-separator"></div><button class="icon-button small" aria-label={$t("Réduire la partition")} disabled={zoom <= 0.6} onclick={() => zoom = Math.max(0.6, +(zoom - 0.1).toFixed(1))}><Minus size={16} /></button><button class="zoom-label" title={$t("Réinitialiser le zoom")} onclick={() => zoom = 1}>{Math.round(zoom * 100)}<span>%</span></button><button class="icon-button small" aria-label={$t("Agrandir la partition")} disabled={zoom >= 1.8} onclick={() => zoom = Math.min(1.8, +(zoom + 0.1).toFixed(1))}><Plus size={16} /></button>{/if}<button class="atelier-button" aria-label={$t("Voix & instruments")} title={$t("Voix & instruments")} class:pressed={mixerOpen} onclick={() => mixerOpen = !mixerOpen}><SlidersHorizontal size={18} /><span>{$t("Voix & instruments")}</span></button><button class="icon-button fullscreen-button" title={$t("Plein écran (F)")} aria-label={$t("Plein écran")} onclick={() => void toggleFullscreen()}>{#if fullscreen}<Minimize2 size={18} />{:else}<Maximize2 size={18} />{/if}</button></div>
      </div>

      <div class="score-area" class:piano-mode={pianoMode} class:selecting={!!loopSelecting}>
        {#if loopSelecting}<div class="selection-hint"><Repeat2 size={16} />{loopSelecting === 'a' ? $t('Choisissez le début du passage') : $t('Choisissez la dernière note du passage')}<button class="icon-button small" aria-label={$t("Annuler la sélection")} onclick={() => loopSelecting = null}><X size={15} /></button></div>{/if}
        {#if loopEnabled && loopA !== null && loopB !== null && !loopSelecting && !replayTake}<div class="loop-chip"><Repeat2 size={13} /> {$t('Passage {start} — {end}', {start: timeLabel(loopA), end: timeLabel(loopB)})}<button aria-label={$t("Désactiver la boucle")} onclick={() => { loopEnabled = false; syncLoop(); }}><X size={13} /></button></div>{/if}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (The score has its own Space and arrow-key controls.) -->
        <div class="score-viewport" role="region" aria-roledescription={$t("Partition interactive")} aria-hidden={pianoMode} aria-label={$t("Partition musicale, flèches pour naviguer entre les notes")} tabindex={pianoMode ? -1 : 0} onkeydown={(event) => { onKey(event); event.stopPropagation(); }} class:horizontal={mode === 'horizontal'} bind:this={viewport} onclick={scoreClick} onpointerdown={pointerDown} onpointermove={pointerMove} onwheel={() => setFollow(false)} ontouchmove={() => setFollow(false)} ondragover={(e) => e.preventDefault()} ondrop={(e) => { e.preventDefault(); void importFile(e.dataTransfer?.files[0]); }}>
          <div class="score-content" class:horizontal={mode === 'horizontal'} bind:this={content}>
            {#each pages as page, i}<div class="sheet-page" data-page={i + 1}>{@html page}</div>{/each}
            {#if loopEnabled && !replayTake}{#each loopBoxes as box}<div class="loop-region" style:left="{box.x}px" style:top="{box.y}px" style:width="{box.width}px" style:height="{box.height}px"></div>{/each}{/if}
            {#if selection && !playing}<div class="selected-note" style:left="{selection.x - 9}px" style:top="{selection.y - 9}px"></div>{/if}
            <div class="reading-cursor" class:paused={!playing} bind:this={cursor}><span></span></div>
            {#if geometry && (tracePath || pendingTracePath)}<svg class="pitch-overlay" width={geometry.width} height={geometry.height} aria-hidden="true">{#if tracePath}<path class="pitch-confirmed" d={tracePath} fill="none" stroke="var(--coral)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />{/if}{#if pendingTracePath}<path class="pitch-pending" d={pendingTracePath} fill="none" stroke="var(--coral)" stroke-width="2.4" stroke-dasharray="3 3" opacity="0.65" stroke-linecap="round" stroke-linejoin="round" />{/if}</svg>{/if}
          </div>
        </div>
        {#if busy || layoutBusy}<div class="loading-overlay" class:subtle={layoutBusy && !busy}><LoaderCircle class="spin" size={25} /><span>{$t(busy ? status || 'Ouverture de la partition…' : 'Mise en page…')}</span></div>{/if}
        {#if error}<div class="error-card"><Music2 size={28} /><h2>{$t("Erreur de chargement")}</h2><p>{$t(error)}</p><button class="primary-button" onclick={() => fileInput.click()}>{$t("Ouvrir une partition")}</button><button class="text-button" onclick={() => error = ''}>{$t("Fermer")}</button></div>{/if}
        {#if pianoMode}<div class="piano-workspace"><PianoKeyboard scoreNotes={pianoScoreNotes} {detectedPitch} micActive={micActive || !!replayTake} onplay={playPiano} onrelease={(midi) => audio.pianoNoteOff(midi)} /></div>{/if}
      </div>

      {#if keyboardOpen && !pianoMode}
        <div class="reference-keyboard"><button class="icon-button small close-reference" aria-label={$t("Fermer le clavier")} onclick={() => keyboardOpen = false}><X size={15} /></button><PianoKeyboard compact scoreNotes={pianoScoreNotes} {detectedPitch} micActive={micActive || !!replayTake} onplay={playPiano} onrelease={(midi) => audio.pianoNoteOff(midi)} /></div>
      {/if}

      <footer class="transport" class:replay-transport={!!replayTake}>
        {#if replayTake}
          <audio bind:this={replayAudio} src={replayURL} preload="auto" onended={() => { playing = false; replayPosition = replayTake?.duration || 0; showControls(); }}></audio>
          <div class="replay-heading"><AudioLines size={17} /><strong>{$t("Réécoute")}</strong><span>{replayTake.title}</span><button class="icon-button" aria-label={$t("Consulter les enregistrements")} onclick={() => { takesOpen = true; mixerOpen = false; libraryOpen = false; }}><Library size={18} /></button><button class="icon-button" aria-label={$t("Quitter la réécoute")} onclick={stopReplay}><X size={19} /></button></div>
          <div class="replay-controls"><button class="play-button" aria-label={playing ? $t('Pause de la réécoute') : $t('Lire l’enregistrement')} onclick={() => void toggleReplay()}>{#if playing}<Pause size={22} fill="currentColor" />{:else}<Play size={22} fill="currentColor" />{/if}</button><span>{timeLabel(replayPosition)}</span><input type="range" aria-label={$t("Position dans l’enregistrement")} min="0" max={replayTake.duration || 1} step="0.01" value={replayPosition} oninput={e => seekReplay(+e.currentTarget.value)} /><span>{timeLabel(replayTake.duration)}</span><button class="icon-button" aria-label={$t("Exporter l’enregistrement")} onclick={() => void exportTake(replayTake)}><Download size={18} /></button></div>
        {:else}
        <div class="timeline-row"><span class="elapsed">{timeLabel(position)}</span><div class="timeline-wrap"><input type="range" min="0" max={duration || 1} step="0.01" value={position} disabled={!audioReady} aria-label={$t("Position dans le morceau")} style="--progress:{duration ? position / duration * 100 : 0}%" oninput={(e) => seek(+e.currentTarget.value)} />{#if loopA !== null && loopB !== null}<span class="timeline-loop" style:left="{loopA / duration * 100}%" style:width="{(loopB - loopA) / duration * 100}%"></span>{/if}</div><span>{timeLabel(duration)}</span><span class="measure-label">{$t('mes. {number}', {number: currentMeasure})}</span></div>
        <div class="transport-main"><div class="playback-buttons"><button class="icon-button restart" title={$t("Revenir au début")} aria-label={$t("Revenir au début")} onclick={restart} disabled={!audioReady}><RotateCcw size={19} /></button><button class="icon-button skip" title={$t("Note précédente")} aria-label={$t("Note précédente")} onclick={() => navigateNote(-1)} disabled={!audioReady}><SkipBack size={19} /></button><button class="play-button" class:is-playing={playing} title={$t("Lecture / pause (Espace)")} aria-label={playing ? $t('Pause') : $t('Lire')} disabled={!audioReady} onclick={() => void togglePlayback()}>{#if audioBusy}<LoaderCircle class="spin" size={24} />{:else if playing}<Pause size={24} fill="currentColor" />{:else}<Play size={24} fill="currentColor" />{/if}</button><button class="icon-button skip" title={$t("Note suivante")} aria-label={$t("Note suivante")} onclick={() => navigateNote(1)} disabled={!audioReady}><SkipForward size={19} /></button></div>
          <div class="tempo-control"><div class="tempo-value"><strong>{tempo}</strong><span>BPM</span><button title={$t("Tempo d’origine")} onclick={() => setRate(1)}>{Math.round(rate * 100)}%</button></div><input type="range" aria-label={$t("Vitesse de lecture")} min="0.3" max="1.5" step="0.01" value={rate} oninput={(e) => setRate(+e.currentTarget.value)} /></div>

          <div class="practice-tools"><div class="loop-tool"><button class="tool-button" class:active={loopEnabled || !!loopSelecting} title={$t("Sélectionner un passage à répéter (L)")} disabled={!audioReady} onclick={startLoopSelection}><Repeat2 size={19} /><span>{$t("Boucle")}</span></button>{#if loopA !== null && loopB !== null}<button class="loop-toggle" class:enabled={loopEnabled} aria-label={$t("Activer la répétition du passage")} aria-pressed={loopEnabled} onclick={() => { loopEnabled = !loopEnabled; syncLoop(); }}><span></span></button>{/if}</div><button class="tool-button keyboard-tool" class:active={keyboardOpen} title={$t("Clavier de référence")} onclick={() => { if (pianoMode) { pianoMode = false; keyboardOpen = true; } else keyboardOpen = !keyboardOpen; }}><Piano size={19} /><span>{$t("Clavier")}</span></button><button class="tool-button recordings-tool" title={$t("Enregistrements")} aria-label={$t("Enregistrements")} disabled={takePhase !== 'idle'} onclick={() => { takesOpen = true; mixerOpen = false; libraryOpen = false; }}><AudioLines size={19} /><span>{$t("Essais")}</span></button></div>
          <div class="vocal-tools">
          <button class="mic-button" class:active={micActive} title={micActive ? $t('Arrêter le microphone') : $t('Écouter ma voix')} aria-label={micActive ? $t('Arrêter le microphone') : $t('Écouter ma voix')} disabled={micBusy || takePhase === 'preparing' || takePhase === 'saving'} onclick={() => void toggleMic()}>{#if micBusy}<LoaderCircle class="spin" size={19} />{:else if micActive}<Mic size={19} />{:else}<MicOff size={19} />{/if}<span><strong>{micActive ? pitchResult?.frequency ? noteLabel(pitchResult.midi) : $t('Chantez…') : $t('Ma voix')}</strong>{#if micActive}<small>{pitchError !== null ? `${pitchError > 0 ? '+' : ''}${pitchError} cents` : $t('Micro actif')}</small>{/if}</span>{#if micActive}<i class="mic-indicator"></i>{/if}</button>
          <div class="recording-strip">
            <div class="take-actions">

              <button class="take-button" class:recording={takePhase === 'recording'} disabled={!audioReady || takePhase === 'preparing' || takePhase === 'saving'} aria-label={takePhase === 'recording' ? $t('Arrêter l’essai') : $t('Enregistrer un essai')} title={$t('Enregistrement : 10 minutes maximum et moins de 64 Mio ; la durée dépend de la fréquence audio.')} onclick={() => takePhase === 'recording' ? void finishTake() : void startTake()}>{#if takePhase === 'preparing' || takePhase === 'saving'}<LoaderCircle class="spin" size={15} />{:else if takePhase === 'recording'}<Square size={13} fill="currentColor" />{:else}<Circle size={13} fill="currentColor" />{/if}<span>{takePhase === 'preparing' ? $t('Préparation…') : takePhase === 'saving' ? $t('Sauvegarde…') : takePhase === 'recording' ? countIn ? `${countIn}…` : timeLabel(takeSeconds) : $t('Enregistrer')}</span></button>
            </div>
            <span class="take-status sr-only" role="status">{#if takePhase === 'recording'}{countIn ? $t('Départ dans {count}…', {count: countIn}) : $t('Essai en cours · {duration}', {duration: timeLabel(takeSeconds)})}{:else if takePhase === 'saving'}{$t("Sauvegarde de l’essai…")}{:else if lastTake}{$t('Dernier essai conservé · {duration}', {duration: timeLabel(lastTake.duration)})}{/if}</span>
          </div>
          </div>
        </div>
        {/if}
      </footer>
    </main>

    {#if mixerOpen}
      <button class="drawer-backdrop mixer-backdrop" aria-label={$t("Fermer les instruments")} onclick={() => mixerOpen = false}></button>
      <aside class="mixer-panel"><div class="section-heading"><span>{$t("Voix & instruments")}</span><button class="icon-button small" aria-label={$t("Fermer les instruments")} onclick={() => mixerOpen = false}><X size={18} /></button></div>
        <label class="target-label" for="voice-target">{$t("VOIX À TRAVAILLER")}</label><select id="voice-target" bind:value={targetChannel} onchange={() => { clearPitchTrace(); scheduleSave(); }}>{#each parts as part}<option value={part.channel}>{part.name}</option>{/each}</select>
        <div class="instrument-list">{#each parts as part}<div class="instrument-card"><div class="instrument-name"><span class="instrument-icon">{#if part.channel === targetChannel}<Mic size={17} />{:else}<Piano size={17} />{/if}</span><strong>{part.name}</strong><button class="mute-button" class:active={part.muted} title={$t('Couper {name}', {name: part.name})} aria-label={$t('Couper {name}', {name: part.name})} aria-pressed={part.muted} onclick={() => { part.muted = !part.muted; applyMix(); }}>{#if part.muted}<VolumeX size={16} />{:else}<Volume2 size={16} />{/if}</button><button class="solo-button" class:active={part.solo} title={$t('Écouter seulement {name}', {name: part.name})} aria-label={$t('Solo {name}', {name: part.name})} aria-pressed={part.solo} onclick={() => { part.solo = !part.solo; applyMix(); }}>S</button></div><div class="volume-row"><input type="range" min="0" max="127" step="1" value={part.volume} aria-label={$t('Volume {name}', {name: part.name})} oninput={(event) => { part.volume = +event.currentTarget.value; applyMix(); }} /><span>{Math.round(part.volume / 100 * 100)}%</span></div><div class="instrument-details"><select aria-label={$t('Son de {name}', {name: part.name})} value={part.program} onchange={(event) => { part.program = +event.currentTarget.value; applyMix(); }}>{#if !programs.some((p) => p.value === part.program)}<option value={part.program}>{$t("Instrument d’origine")}</option>{/if}{#each programs as program}<option value={program.value}>{$t(program.name)}</option>{/each}</select><div class="transpose-control"><button aria-label={$t('Transposer {name} vers le bas', {name: part.name})} disabled={part.transpose <= -24} onclick={() => { part.transpose--; applyMix(); }}><Minus size={13} /></button><span title={$t("Transposition audio en demi-tons")}>{part.transpose > 0 ? '+' : ''}{part.transpose}</span><button aria-label={$t('Transposer {name} vers le haut', {name: part.name})} disabled={part.transpose >= 24} onclick={() => { part.transpose++; applyMix(); }}><Plus size={13} /></button></div></div></div>{/each}</div>
        <div class="micro-settings"><div class="section-heading"><span>{$t("RETOUR DE VOIX")}</span><Mic size={15} /></div><p>{$t("La courbe suit votre voix. Sa fin en pointillés réagit immédiatement puis devient pleine après confirmation. Utilisez un casque pour isoler votre voix.")}</p><label for="microphone">{$t("Entrée microphone")}</label><select id="microphone" bind:value={microphoneId} onchange={() => void changeMicrophone()} disabled={micBusy || takePhase !== 'idle'}><option value="">{$t("Par défaut du système")}</option>{#each microphones as device}<option value={device.deviceId}>{device.label || $t('Microphone {number}', {number: microphones.indexOf(device) + 1})}</option>{/each}</select>{#if micActive && microphoneLabel}<p class="microphone-source">{$t('Entrée active : {name}.', {name: microphoneLabel})}{#if /noise|cancel|rnnoise/i.test(microphoneLabel)} {$t("La réduction de bruit peut couper du chant. Essayez l’entrée physique pour comparer.")}{/if}</p>{/if}<label for="latency">{$t("Décalage micro")} <strong>{latency} ms</strong></label><input id="latency" type="range" min="-200" max="400" step="10" bind:value={latency} /><button class="text-button clear-trace" onclick={clearPitchTrace}>{$t("Effacer la courbe")}</button></div>
        <button class="export-button" disabled={!music} onclick={exportPractice}><Download size={15} /> {$t("Exporter le MusicXML original")}</button>
      </aside>
    {/if}
  </div>

  <button class="immersive-reveal" aria-label={$t("Afficher les commandes")} onclick={showControls}><ChevronDown size={18} /></button>
  {#if takePhase === 'recording'}<button class="recording-pill" aria-label={$t("Arrêter l’enregistrement")} onclick={() => void finishTake()}><i class="recording-dot"></i><span>{countIn ? $t('Départ dans {count}…', {count: countIn}) : $t('Essai · {duration}', {duration: timeLabel(takeSeconds)})}</span><Square size={11} fill="currentColor" /></button>{/if}
  {#if toast}<div class="toast" role="status"><Check size={16} /><span>{$t(toast)}</span><button class="icon-button small" aria-label={$t("Fermer le message")} onclick={() => toast = ''}><X size={14} /></button></div>{/if}

  {#if helpOpen}
    <div class="modal-backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) helpOpen = false; }}><div class="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" tabindex="-1"><button class="icon-button close-dialog" aria-label={$t("Fermer l’aide")} onclick={() => helpOpen = false}><X size={20} /></button><Brand /><h2 id="help-title">{$t("Aide et raccourcis")}</h2><p>{$t("Ouvrez une partition MusicXML, choisissez votre tempo et répétez un passage. Vos fichiers et le son du micro sont traités sur cet appareil.")}</p><div class="help-shortcuts"><span>{$t("Lecture / pause")}<kbd>{$t("Espace")}</kbd></span><span>{$t("Note précédente / suivante")}<kbd>← →</kbd></span><span>{$t("Choisir un passage")}<kbd>L</kbd></span><span>{$t("Plein écran")}<kbd>F</kbd></span></div><p class="help-note">{$t("Un essai dure au maximum 10 minutes et occupe moins de 64 Mio. Selon la fréquence audio et la taille de la partition, la limite peut être plus courte.")}</p><p class="help-note">{$t("Sur téléphone, le mode Auto propose la partition en portrait et le ruban en paysage. Touchez la partition pour retrouver les commandes.")}</p><p class="help-note">{$t("Client sous GPLv3 ·")} <a href="{import.meta.env.BASE_URL}source/chansonade-source.tar.gz">{$t("Code source")}</a> · <a href="{import.meta.env.BASE_URL}legal/THIRD_PARTY.md">{$t("Licences et crédits")}</a></p><button class="primary-button" onclick={() => helpOpen = false}>{$t("Fermer")}</button></div></div>
  {/if}
  {#if takesOpen}<TakePanel memoryTakes={memoryTakes.filter(entry => entry.scope === takeScope).map(entry => entry.take)} ondiscard={id => memoryTakes = memoryTakes.filter(entry => entry.scope !== takeScope || entry.take.id !== id)} onclose={() => takesOpen = false} onplay={replay} onexport={take => void exportTake(take)} onerror={notify} blocked={takePhase !== 'idle'} />{/if}
  {#if accountOpen}<AccountPanel onclose={() => accountOpen = false} beforechange={savePractice} ondelete={scope => memoryTakes = memoryTakes.filter(entry => entry.scope !== scope)} blocked={takePhase !== 'idle'} bind:invitation bind:resetToken />{/if}
</div>
