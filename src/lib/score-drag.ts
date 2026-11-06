import type { MessageParams } from './i18n';
import type { Organization } from './organization';
import { moveItem, storageScope, subscribeStorage } from './storage';

type Options = {
  scope: string;
  blocked: boolean;
  organization: Organization;
  expand: (id: string) => void;
  announce: (key: string, params?: MessageParams) => void;
};
type Destination = {
  element: HTMLElement;
  folderId: string | null;
  label: string;
  reveal: string | null;
  revealAt: number | null;
};
type Gesture = {
  pointerId: number;
  scope: string;
  id: string;
  title: string;
  handle: HTMLButtonElement;
  origin: { x: number; y: number };
  point: { x: number; y: number };
  phase: 'pending' | 'dragging';
  destination: Destination | null;
  preview: HTMLDivElement | null;
  frame: number | null;
  previousFrame: number;
};

/** One pointer gesture for mouse, pen and touch, confined to the score handle. */
export function scoreDrag(node: HTMLElement, initial: Options) {
  let options = initial;
  let gesture: Gesture | null = null;
  const panel = node.closest<HTMLElement>('.library-panel')!;

  function finish(): Gesture | null {
    const current = gesture;
    gesture = null;
    if (current) {
      if (current.frame !== null) cancelAnimationFrame(current.frame);
      current.preview?.remove();
      current.destination?.element.removeAttribute('data-score-drop-active');
      node.removeAttribute('data-score-dragging');
    }
    return current;
  }
  function release(current: Gesture) {
    if (current.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
  }
  function cancel() {
    const current = finish();
    if (!current) return;
    release(current);
    if (current.phase === 'dragging') options.announce('Déplacement annulé.');
  }
  function destinationAt(current: Gesture): HTMLElement | null {
    const element = document.elementFromPoint(current.point.x, current.point.y)?.closest<HTMLElement>('[data-score-drop]');
    if (!element || !node.contains(element)) return null;
    const id = element.dataset.scoreDrop;
    return id === '' || options.organization.destinations().some(folder => folder.id === id) ? element : null;
  }
  function hover(current: Gesture, now: number) {
    const element = destinationAt(current);
    if (current.destination?.element !== element) {
      current.destination?.element.removeAttribute('data-score-drop-active');
      current.destination = element ? {
        element, folderId: element.dataset.scoreDrop || null, label: element.dataset.scoreDropLabel || '',
        reveal: element.dataset.scoreReveal || null, revealAt: now + 600,
      } : null;
      element?.setAttribute('data-score-drop-active', '');
    }
    const target = current.destination;
    if (target) {
      target.label = target.element.dataset.scoreDropLabel || '';
      if (target.reveal !== null && target.revealAt !== null && now >= target.revealAt) {
        target.revealAt = null;
        if (target.element.querySelector('.disclosure')?.getAttribute('aria-expanded') === 'false') options.expand(target.reveal);
      }
    }
  }
  function animate(now: number) {
    const current = gesture;
    if (!current || current.phase !== 'dragging') return;
    if (!current.handle.isConnected || (current.destination && !current.destination.element.isConnected)
      || options.blocked || current.scope !== storageScope()) { cancel(); return; }
    const bounds = panel.getBoundingClientRect();
    const elapsed = Math.min(32, now - current.previousFrame);
    current.previousFrame = now;
    if (current.point.x >= bounds.left && current.point.x <= bounds.right && current.point.y >= bounds.top && current.point.y <= bounds.bottom) {
      const edge = Math.min(48, bounds.height / 4);
      const top = current.point.y - bounds.top, bottom = bounds.bottom - current.point.y;
      const speed = top < edge ? -(1 - top / edge) : bottom < edge ? 1 - bottom / edge : 0;
      panel.scrollTop += speed * 720 * elapsed / 1000;
    }
    hover(current, now);
    current.preview!.style.transform = `translate(${current.point.x + 12}px, ${current.point.y + 12}px)`;
    current.frame = requestAnimationFrame(animate);
  }
  function down(event: PointerEvent) {
    const handle = (event.target as Element).closest<HTMLButtonElement>('[data-score-drag]');
    if (!handle || !node.contains(handle) || handle.disabled || gesture || !event.isPrimary || event.button !== 0
      || options.blocked || options.scope !== storageScope()) return;
    const id = handle.dataset.scoreDrag!;
    if (!options.organization.matches('score', id)) return;
    event.preventDefault(); event.stopPropagation();
    handle.focus({ preventScroll: true });
    handle.setPointerCapture(event.pointerId);
    gesture = {
      pointerId: event.pointerId, scope: options.scope, id, title: handle.dataset.scoreTitle!, handle,
      origin: { x: event.clientX, y: event.clientY }, point: { x: event.clientX, y: event.clientY },
      phase: 'pending', destination: null, preview: null, frame: null, previousFrame: 0,
    };
  }
  function move(event: PointerEvent) {
    const current = gesture;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    current.point = { x: event.clientX, y: event.clientY };
    if (current.phase === 'pending' && Math.hypot(current.point.x - current.origin.x, current.point.y - current.origin.y) >= 8) {
      current.phase = 'dragging';
      current.preview = document.createElement('div');
      current.preview.className = 'score-drag-preview';
      current.preview.setAttribute('aria-hidden', 'true');
      current.preview.textContent = current.title;
      node.append(current.preview);
      node.setAttribute('data-score-dragging', '');
      current.previousFrame = performance.now();
      current.frame = requestAnimationFrame(animate);
      options.announce('Glissez « {title} » vers un dossier.', { title: current.title });
    }
    if (current.phase === 'dragging') hover(current, performance.now());
  }
  async function up(event: PointerEvent) {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const current = finish()!;
    // Native pointerup releases capture after dispatch, so its click still targets
    // the handle rather than opening the score or activating the destination.
    const target = current.destination;
    if (current.phase !== 'dragging') return;
    if (!target?.element.isConnected || options.blocked || current.scope !== storageScope()) {
      options.announce('Déplacement annulé.'); return;
    }
    try {
      await moveItem('score', current.id, target.folderId, current.scope);
      if (node.isConnected && current.scope === storageScope()) {
        options.expand(target.folderId ?? 'unfiled');
        options.announce('Partition « {title} » déplacée vers « {folder} ».', { title: current.title, folder: target.label });
      }
    } catch (cause) {
      if (node.isConnected && current.scope === storageScope()) options.announce(cause instanceof Error ? cause.message : 'Impossible de déplacer cet élément.');
    }
  }
  function pointerCancelled(event: PointerEvent) { if (gesture?.pointerId === event.pointerId) cancel(); }
  function key(event: KeyboardEvent) {
    if (event.key === 'Escape' && gesture) { event.preventDefault(); event.stopPropagation(); cancel(); }
  }
  const unsubscribe = subscribeStorage(event => { if (event.reason === 'scope') cancel(); });
  node.addEventListener('pointerdown', down);
  node.addEventListener('lostpointercapture', pointerCancelled);
  window.addEventListener('pointermove', move, { capture: true, passive: false });
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', pointerCancelled, true);
  window.addEventListener('keydown', key, true);
  window.addEventListener('blur', cancel);
  return {
    update(next: Options) {
      options = next;
      const current = gesture;
      if (current && (next.blocked || current.scope !== next.scope || !next.organization.matches('score', current.id)
        || (current.destination?.folderId && !next.organization.destinations().some(folder => folder.id === current.destination?.folderId)))) cancel();
    },
    destroy() {
      unsubscribe();
      const current = finish(); if (current) release(current);
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('lostpointercapture', pointerCancelled);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', pointerCancelled, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', cancel);
    },
  };
}
