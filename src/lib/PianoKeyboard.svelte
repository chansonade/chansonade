<script lang="ts">
  import { onMount } from 'svelte';
  import { ChevronLeft, ChevronRight, Crosshair, Keyboard, Mic, Minus, Plus, Music2 } from '@lucide/svelte';

  let { compact = false, scoreNotes = [], detectedPitch = null, micActive = false, onplay, onrelease }: {
    compact?: boolean;
    scoreNotes: { midi: number; target: boolean }[];
    detectedPitch: number | null;
    micActive: boolean;
    onplay: (midi: number) => void;
    onrelease: (midi: number) => void;
  } = $props();

  const notes = Array.from({ length: 88 }, (_, index) => index + 21);
  const black = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);
  const whites = notes.filter((midi) => !black(midi));
  const blacks = notes.filter(black);
  const whiteIndex = new Map(whites.map((midi, index) => [midi, index]));
  const names = ['Do', 'Do♯', 'Ré', 'Ré♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
  const pcCodes = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL', 'KeyP', 'Semicolon'];
  const pcLabels = {
    azerty: ['Q', 'Z', 'S', 'E', 'D', 'F', 'T', 'G', 'Y', 'H', 'U', 'J', 'K', 'O', 'L', 'P', 'M'],
    qwerty: ['A', 'W', 'S', 'E', 'D', 'F', 'T', 'G', 'Y', 'H', 'U', 'J', 'K', 'O', 'L', 'P', ';'],
  };
  let root: HTMLElement;
  let scrollArea: HTMLDivElement;
  let keybed: HTMLDivElement;
  let layout = $state<'azerty' | 'qwerty'>('azerty');
  let pcBase = $state(48);
  let pressedNotes = $state<number[]>([]);
  let viewRange = $state('Do2 – Do5');
  let canPanLeft = $state(true);
  let canPanRight = $state(true);
  let previousViewportWidth = 0;
  let previousKeybedWidth = 0;
  const sources = new Map<string, number>();
  const counts = new Map<number, number>();
  const pointers = new Set<number>();
  const pressed = $derived(new Set(pressedNotes));
  const score = $derived.by(() => {
    const result = new Map<number, boolean>();
    for (const note of scoreNotes) result.set(note.midi, (result.get(note.midi) ?? false) || note.target);
    return result;
  });
  const validPitch = $derived(micActive && detectedPitch !== null && Number.isFinite(detectedPitch) ? detectedPitch : null);
  const nearestPitch = $derived(validPitch === null ? null : Math.round(validPitch));
  const cents = $derived(validPitch === null ? 0 : Math.round((validPitch - Math.round(validPitch)) * 100));
  const frequency = $derived(validPitch === null ? null : 440 * 2 ** ((validPitch - 69) / 12));
  const marker = $derived(validPitch !== null && validPitch >= 21 && validPitch <= 108 ? pitchPosition(validPitch) : null);

  function label(midi: number) { return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`; }
  function keyPosition(midi: number) {
    return black(midi) ? whites.filter((white) => white < midi).length : (whiteIndex.get(midi) ?? 0) + 0.5;
  }
  function pitchPosition(midi: number) {
    const low = Math.floor(midi), high = Math.min(108, low + 1);
    return (keyPosition(low) + (keyPosition(high) - keyPosition(low)) * (midi - low)) / whites.length * 100;
  }
  function pcLabel(midi: number) { return pcLabels[layout][midi - pcBase] || ''; }
  function assign(source: string, midi: number | null) {
    const old = sources.get(source);
    if (old === midi) return;
    if (old !== undefined) {
      sources.delete(source);
      const remaining = (counts.get(old) || 1) - 1;
      if (remaining) counts.set(old, remaining);
      else { counts.delete(old); onrelease(old); }
    }
    if (midi !== null && midi >= 21 && midi <= 108) {
      const held = counts.get(midi) || 0;
      sources.set(source, midi);
      counts.set(midi, held + 1);
      if (!held) onplay(midi);
    }
    pressedNotes = [...counts.keys()].sort((a, b) => a - b);
  }
  function releaseAll() {
    const held = [...counts.keys()];
    sources.clear(); counts.clear(); pressedNotes = [];
    for (const id of pointers) if (keybed?.hasPointerCapture(id)) keybed.releasePointerCapture(id);
    pointers.clear();
    for (const midi of held) onrelease(midi);
  }
  function releasePC() {
    for (const source of [...sources.keys()]) if (source.startsWith('pc:')) assign(source, null);
  }
  function changePCOctave(direction: number) {
    releasePC(); pcBase = Math.max(24, Math.min(96, pcBase + direction * 12));
    scrollToNote(pcBase, true);
  }
  function startPointer(event: PointerEvent, midi: number) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    root.focus({ preventScroll: true });
    pointers.add(event.pointerId);
    keybed.setPointerCapture(event.pointerId);
    assign(`pointer:${event.pointerId}`, midi);
  }
  function movePointer(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return;
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-piano-midi]');
    const midi = hit && keybed.contains(hit) ? Number(hit.dataset.pianoMidi) : null;
    assign(`pointer:${event.pointerId}`, midi);
  }
  function finishPointer(event: PointerEvent) {
    pointers.delete(event.pointerId);
    assign(`pointer:${event.pointerId}`, null);
    if (keybed.hasPointerCapture(event.pointerId)) keybed.releasePointerCapture(event.pointerId);
  }
  function onKeyDown(event: KeyboardEvent) {
    if ((event.target as HTMLElement).closest('input, select, textarea, [contenteditable="true"]')) return;
    if (event.code === 'Space' && event.target === root) return;
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); releaseAll(); return; }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const index = pcCodes.indexOf(event.code);
    if (index >= 0) {
      event.preventDefault();
      if (!event.repeat) assign(`pc:${event.code}`, pcBase + index);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); pan(event.key === 'ArrowLeft' ? -1 : 1);
    }
  }
  function onKeyUp(event: KeyboardEvent) {
    if (!sources.has(`pc:${event.code}`)) return;
    event.preventDefault(); event.stopPropagation(); assign(`pc:${event.code}`, null);
  }
  function focusOut(event: FocusEvent) {
    if (!(event.relatedTarget instanceof Node) || !root.contains(event.relatedTarget)) releaseAll();
  }
  function updateViewport() {
    if (!scrollArea || !keybed) return;
    const width = keybed.scrollWidth / whites.length;
    const first = Math.max(0, Math.floor(scrollArea.scrollLeft / width));
    const last = Math.min(whites.length - 1, Math.ceil((scrollArea.scrollLeft + scrollArea.clientWidth) / width) - 1);
    viewRange = `${label(whites[first])} – ${label(whites[last])}`;
    canPanLeft = scrollArea.scrollLeft > 1;
    canPanRight = scrollArea.scrollLeft + scrollArea.clientWidth < scrollArea.scrollWidth - 1;
  }
  function resizeViewport() {
    const width = scrollArea.clientWidth, keyboardWidth = keybed.scrollWidth;
    if (previousViewportWidth && previousKeybedWidth && (width !== previousViewportWidth || keyboardWidth !== previousKeybedWidth)) {
      const center = (scrollArea.scrollLeft + previousViewportWidth / 2) / previousKeybedWidth;
      scrollArea.scrollLeft = center * keyboardWidth - width / 2;
    }
    previousViewportWidth = width;
    previousKeybedWidth = keyboardWidth;
    updateViewport();
  }
  function pan(direction: number) {
    scrollArea.scrollBy({ left: direction * 7 * keybed.scrollWidth / whites.length, behavior: 'smooth' });
  }
  function scrollToNote(midi: number, center = false, smooth = true) {
    if (!scrollArea || !keybed) return;
    const x = pitchPosition(Math.max(21, Math.min(108, midi))) / 100 * keybed.scrollWidth;
    scrollArea.scrollTo({ left: Math.max(0, x - (center ? scrollArea.clientWidth / 2 : keybed.scrollWidth / whites.length / 2)), behavior: smooth ? 'smooth' : 'instant' });
    updateViewport();
  }
  onMount(() => {
    const frame = requestAnimationFrame(() => {
      const target = scoreNotes.find((note) => note.target)?.midi;
      const reference = validPitch ?? pcBase;
      scrollToNote(target === undefined ? reference : (target + reference) / 2, true, false);
    });
    const observer = new ResizeObserver(resizeViewport);
    observer.observe(scrollArea);
    observer.observe(keybed);
    window.addEventListener('blur', releaseAll);
    const hidden = () => { if (document.hidden) releaseAll(); };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener('blur', releaseAll); document.removeEventListener('visibilitychange', hidden);
      releaseAll();
    };
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (A musical keyboard is a custom application widget with local PC-key handling.) -->
<section class="piano-keyboard" class:compact role="application" aria-label="Clavier de piano : cliquez ici pour jouer au clavier de l’ordinateur" tabindex="0" bind:this={root} onkeydown={onKeyDown} onkeyup={onKeyUp} onfocusout={focusOut}>
  <header class="piano-heading">
    <div class="heading-label"><Keyboard size={compact ? 14 : 18} /><strong>{compact ? 'Clavier' : 'Piano'}</strong>{#if !compact}<span>88 notes · La0 à Do8</span>{/if}</div>
    <div class="computer-controls">
      <label class="layout-choice"><span class="sr-only">Disposition du clavier d’ordinateur</span><select aria-label="Disposition du clavier d’ordinateur" bind:value={layout} onchange={releasePC}><option value="azerty">AZERTY</option><option value="qwerty">QWERTY</option></select></label>
      <div class="pc-octave" title="Registre des touches de l’ordinateur"><button type="button" aria-label="Descendre le registre du clavier d’ordinateur" disabled={pcBase <= 24} onclick={() => changePCOctave(-1)}><Minus size={12} /></button><span>PC <strong>{label(pcBase)}</strong></span><button type="button" aria-label="Monter le registre du clavier d’ordinateur" disabled={pcBase >= 96} onclick={() => changePCOctave(1)}><Plus size={12} /></button></div>
    </div>
  </header>
  {#if !compact}
    <div class="piano-readouts">
      <div class="played-readout"><span>NOTES JOUÉES</span><strong class:empty={!pressedNotes.length}>{pressedNotes.length ? pressedNotes.map(label).join(' · ') : 'Aucune touche enfoncée'}</strong></div>
      <div class="voice-readout" class:listening={micActive}><Mic size={17} /><div><span>{micActive ? 'VOTRE VOIX' : 'MICRO EN PAUSE'}</span><strong>{validPitch !== null ? label(Math.round(validPitch)) : micActive ? 'Chantez une note…' : 'Activez le micro pour comparer'}{#if validPitch !== null}<small>{cents > 0 ? '+' : ''}{cents} cents · {frequency?.toFixed(1)} Hz</small>{/if}</strong></div></div>
    </div>
  {/if}
  <div class="keyboard-navigation"><span>{viewRange}</span><small>Glissez la réglette pour explorer</small><div><button type="button" aria-label="Voir l’octave précédente" disabled={!canPanLeft} onclick={() => pan(-1)}><ChevronLeft size={16} /></button><button type="button" aria-label="Recentrer sur les notes de la partition" title="Notes de la partition" onclick={() => scrollToNote(scoreNotes.find((note) => note.target)?.midi ?? scoreNotes[0]?.midi ?? pcBase, true)}><Music2 size={14} /></button><button type="button" class="recenter" aria-label={validPitch !== null ? 'Recentrer sur la voix détectée' : 'Recentrer sur le registre vocal'} onclick={() => scrollToNote(validPitch ?? 48, true)}><Crosshair size={14} /></button><button type="button" aria-label="Voir l’octave suivante" disabled={!canPanRight} onclick={() => pan(1)}><ChevronRight size={16} /></button></div></div>
  <div class="keyboard-scroll" bind:this={scrollArea} onscroll={updateViewport}>
    <div class="keyboard-stage">
      <div class="octave-rail" aria-hidden="true">{#each whites.filter((midi) => midi % 12 === 0) as midi}<span style:left="{(whiteIndex.get(midi) || 0) / whites.length * 100}%">{label(midi)}</span>{/each}</div>
      <div class="keybed" role="group" aria-label="Touches du piano" bind:this={keybed} onpointermove={movePointer} onpointerup={finishPointer} onpointercancel={releaseAll} onlostpointercapture={finishPointer}>
        <div class="white-keys">{#each whites as midi}<button type="button" class="key white" class:pressed={pressed.has(midi)} class:target={score.get(midi) === true} class:accompaniment={score.has(midi) && !score.get(midi)} class:detected={nearestPitch === midi} data-piano-midi={midi} tabindex="-1" aria-label={`${label(midi)}, MIDI ${midi}`} aria-pressed={pressed.has(midi)} onpointerdown={(event) => startPointer(event, midi)}><span class="score-mark"></span>{#if pcLabel(midi)}<kbd>{pcLabel(midi)}</kbd>{/if}<span class="note-name">{#if !compact || midi % 12 === 0}{label(midi)}{/if}</span></button>{/each}</div>
        {#each blacks as midi}<button type="button" class="key black" class:pressed={pressed.has(midi)} class:target={score.get(midi) === true} class:accompaniment={score.has(midi) && !score.get(midi)} class:detected={nearestPitch === midi} style:left="{keyPosition(midi) / whites.length * 100}%" data-piano-midi={midi} tabindex="-1" aria-label={`${label(midi)}, MIDI ${midi}`} aria-pressed={pressed.has(midi)} onpointerdown={(event) => startPointer(event, midi)}><span class="score-mark"></span>{#if pcLabel(midi)}<kbd>{pcLabel(midi)}</kbd>{/if}</button>{/each}
        {#if marker !== null}<div class="voice-marker" style:left="{marker}%" aria-hidden="true"><span></span><i></i></div>{/if}
      </div>
    </div>
  </div>
  <footer class="piano-footer"><div class="legend"><span><i class="target-dot"></i>Voix à travailler</span><span><i class="accompaniment-dot"></i>Accompagnement</span><span><i class="pressed-dot"></i>Joué</span><span><i class="voice-dot"></i>Micro</span></div><p>{compact ? 'Cliquez pour jouer · maintenez les touches' : 'Cliquez sur le piano pour jouer au clavier de l’ordinateur. Maintenez plusieurs touches pour un accord.'}</p></footer>
</section>

<style>
  .piano-keyboard {
    --white-width: 56px;
    --key-height: 260px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 12px;
    flex: 1;
    width: 100%;
    min-width: 0;
    min-height: 0;
    padding: 22px 28px;
    outline: none;
    overflow: hidden;
    background: var(--cream);
    color: var(--ink);
  }
  .piano-keyboard:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); }
  .piano-heading, .heading-label, .computer-controls, .pc-octave, .keyboard-navigation, .keyboard-navigation>div, .legend, .legend>span { display: flex; align-items: center; }
  .piano-heading { justify-content: space-between; gap: 14px; flex-shrink: 0; }
  .heading-label { gap: 9px; min-width: 0; }
  .heading-label>:global(svg), .pc-octave strong { color: var(--accent); flex-shrink: 0; }
  .heading-label strong { font-size: 16px; font-weight: 600; }
  .heading-label>span { font-size: 12px; margin-left: 6px; color: var(--subtle); }
  .computer-controls { gap: 10px; }
  .layout-choice select { font-size: 12px; padding: 8px; min-height: 36px; }
  .pc-octave { border: 1px solid var(--line); border-radius: 6px; overflow: hidden; white-space: nowrap; background: var(--surface); }
  .pc-octave button { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; }
  .pc-octave>span { font-size: 12px; padding: 0 6px; color: var(--subtle); }
  .pc-octave strong { font-weight: 600; margin-left: 3px; }
  .piano-readouts { display: flex; align-items: center; justify-content: space-between; gap: 20px; min-height: 60px; padding: 4px 0; flex-shrink: 0; }
  .played-readout { min-width: 0; }
  .played-readout>span, .voice-readout>div>span { display: block; font-size: 11px; margin-bottom: 5px; color: var(--subtle); }
  .played-readout>strong { font-size: 25px; font-weight: 550; line-height: 1.2; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .played-readout>strong.empty { font-size: 16px; font-weight: 400; color: var(--subtle); }
  .voice-readout { display: flex; align-items: center; gap: 10px; flex-shrink: 0; color: var(--subtle); }
  .voice-readout.listening { color: var(--coral); }
  .voice-readout strong { display: block; font-size: 13px; font-weight: 500; line-height: 1.5; }
  .voice-readout strong small { display: block; font-size: 12px; font-weight: 400; font-variant-numeric: tabular-nums; }
  .keyboard-navigation { justify-content: space-between; gap: 12px; flex-shrink: 0; font-size: 12px; margin-bottom: -8px; color: var(--subtle); }
  .keyboard-navigation>span { font-variant-numeric: tabular-nums; min-width: 85px; }
  .keyboard-navigation>small { font-size: 12px; margin-left: auto; }
  .keyboard-navigation>div { gap: 3px; }
  .keyboard-navigation button { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 5px; color: var(--subtle); }
  .keyboard-navigation button:hover:not(:disabled) { background: var(--accent-soft); }
  .keyboard-scroll { width: 100%; min-width: 0; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scrollbar-width: thin; flex-shrink: 0; padding-bottom: 9px; scrollbar-color: #9fb6de var(--cream); }
  .piano-keyboard:not(.compact) .keyboard-scroll { flex: 1; min-height: 140px; max-height: 380px; }
  .piano-keyboard:not(.compact) .keyboard-stage { height: 100%; }
  .piano-keyboard:not(.compact) .keybed { height: calc(100% - 27px); }
  .keyboard-stage { width: calc(52 * var(--white-width) + 2px); position: relative; padding: 0 1px; }
  .octave-rail { height: 27px; position: relative; touch-action: pan-x; user-select: none; color: var(--subtle); }
  .octave-rail>span { position: absolute; bottom: 6px; border-left: 1px solid var(--line); padding-left: 5px; font-size: 11px; }
  .keybed { height: var(--key-height); position: relative; isolation: isolate; touch-action: none; border-top: 5px solid #253d70; user-select: none; }
  .white-keys { display: flex; width: 100%; height: 100%; gap: 0; background: #d0dced; border-radius: 0 0 4px 4px; overflow: hidden; }
  .key { padding: 0; position: relative; touch-action: none; user-select: none; transition: background .06s, box-shadow .06s; cursor: pointer; outline: none; }
  .key.white { width: var(--white-width); height: 100%; flex: 0 0 var(--white-width); border-right: 1px solid #d0d8e5; border-radius: 0 0 4px 4px; background: #fff; box-shadow: inset 0 -5px 0 #e4e9f2, inset 0 -6px 0 #c2cfe3; }
  .key.white:last-child { border-right: 0; }
  .key.black { position: absolute; top: 0; z-index: 2; transform: translateX(-50%); height: 62%; width: calc(var(--white-width) * .62); border: 1px solid #142440; border-top: 0; border-radius: 0 0 4px 4px; background: linear-gradient(90deg, #17243a, #2b3b55 60%, #17243a); box-shadow: inset 0 -6px 0 #101d33, 0 3px 3px #172b4a22; }
  .key.white.target:not(.pressed) { background: #d6edff; box-shadow: inset 0 -5px 0 #80b8ea; }
  .key.white.accompaniment:not(.pressed):not(.target) { background: #eeeafb; }
  .key.black.target:not(.pressed) { background: #367bc9; }
  .key.white.pressed { background: #c9b8f7; box-shadow: inset 0 -3px 0 #987de2; }
  .key.black.pressed { background: #8060bd; box-shadow: inset 0 -3px 0 #594084; }
  .key.detected { outline: 2px solid var(--coral); outline-offset: -3px; }
  .score-mark { display: none; position: absolute; left: 5px; right: 5px; bottom: 6px; height: 4px; border-radius: 2px; pointer-events: none; background: #2583db; }
  .target>.score-mark, .accompaniment>.score-mark { display: block; }
  .accompaniment>.score-mark { background: #9784d2; height: 3px; }
  .black>.score-mark { left: 4px; right: 4px; bottom: 8px; }
  .note-name { position: absolute; left: 0; right: 0; bottom: 17px; font-size: 12px; pointer-events: none; color: #4d6282; }
  .key kbd { position: absolute; left: 0; right: 0; bottom: 43px; margin: auto; max-width: 25px; font-size: 12px; font-family: inherit; pointer-events: none; color: #4d6282; }
  .key.black kbd { bottom: 23px; font-size: 12px; color: #e3ecfb; }
  .voice-marker { position: absolute; top: -9px; bottom: 0; z-index: 4; width: 1px; pointer-events: none; transform: translateX(-50%); }
  .voice-marker>span { position: absolute; top: 1px; left: -4px; width: 9px; height: 9px; border: 1px solid #fff; transform: rotate(45deg); background: var(--coral); }
  .voice-marker>i { position: absolute; top: 12px; height: 14px; left: 0; border-left: 1px solid var(--coral); }
  .piano-footer { flex-shrink: 0; }
  .legend { gap: 16px; flex-wrap: wrap; font-size: 12px; color: var(--subtle); }
  .legend>span { gap: 6px; white-space: nowrap; }
  .legend i { display: block; width: 8px; height: 8px; border-radius: 2px; }
  .target-dot { background: #2583db; }
  .accompaniment-dot { background: #9784d2; }
  .pressed-dot { background: #a88fe7; }
  .voice-dot { background: var(--coral); transform: rotate(45deg); }
  .piano-footer p { font-size: 12px; line-height: 1.6; margin: 10px 0 0; color: var(--subtle); }
  .compact { --white-width: 44px; --key-height: 88px; padding: 7px 15px; gap: 4px; flex: none; max-height: 100%; }
  .compact .heading-label strong { font-size: 12px; }
  .compact .computer-controls { gap: 6px; }
  .compact .layout-choice select { font-size: 11px; padding: 5px; min-height: 30px; }
  .compact .pc-octave button { width: 30px; height: 30px; }
  .compact .pc-octave>span { font-size: 11px; padding: 0 3px; }
  .compact .keyboard-navigation { font-size: 11px; margin-bottom: -8px; }
  .compact .keyboard-navigation>small { display: none; }
  .compact .keyboard-navigation button { width: 30px; height: 26px; }
  .compact .octave-rail { height: 20px; }
  .compact .octave-rail>span { font-size: 10px; bottom: 4px; }
  .compact .keyboard-scroll { padding-bottom: 4px; }
  .compact .note-name { bottom: 12px; font-size: 10px; }
  .compact .key kbd { bottom: 31px; font-size: 11px; }
  .compact .key.black kbd { bottom: 16px; font-size: 10px; }
  .compact .score-mark { bottom: 4px; height: 3px; }
  .compact .legend { font-size: 10px; gap: 10px; }
  .compact .piano-footer p { display: none; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  @media(max-width:650px) {
    .piano-keyboard { padding: 16px 14px; gap: 9px; --white-width: 52px; }
    .heading-label>span { display: none; }
    .heading-label strong { font-size: 14px; }
    .computer-controls { gap: 5px; }
    .layout-choice select { font-size: 11px; padding: 7px 5px; }
    .pc-octave button { width: 30px; }
    .pc-octave>span { font-size: 11px; padding: 0 2px; }
    .piano-readouts { gap: 8px; align-items: flex-start; flex-direction: column; min-height: 0; padding: 5px 0; }
    .played-readout>span { display: none; }
    .played-readout>strong { font-size: 22px; }
    .played-readout>strong.empty { font-size: 14px; }
    .voice-readout>div>span { display: none; }
    .voice-readout strong { font-size: 12px; }
    .voice-readout strong small { display: inline; margin-left: 8px; font-size: 11px; }
    .keyboard-navigation>small { display: none; }
    .legend { font-size: 11px; gap: 8px 12px; }
    .piano-footer p { font-size: 11px; margin-top: 9px; }
    .compact { padding: 6px 10px; gap: 4px; --white-width: 44px; --key-height: 75px; }
    .compact .heading-label { gap: 5px; }
    .compact .heading-label strong { font-size: 11px; }
    .compact .legend { gap: 8px; font-size: 10px; }
  }
  @media(max-height:500px) and (orientation:landscape) {
    .piano-keyboard:not(.compact) { padding: 6px 16px; gap: 3px; }
    .piano-keyboard:not(.compact) .keyboard-scroll { min-height: 80px; }
    .piano-heading, .piano-readouts { display: none; }
    .keyboard-navigation { margin-bottom: -8px; }
    .keyboard-navigation button { height: 28px; }
    .octave-rail { height: 20px; }
    .piano-keyboard:not(.compact) .keybed { height: calc(100% - 20px); }
    .legend { font-size: 11px; }
    .piano-footer p { display: none; }
  }
</style>
