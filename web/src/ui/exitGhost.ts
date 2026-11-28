import type { RefCallback } from 'react';

/*
 * A window or a menu that its owner unmounts (a Cancel button, a save, a right-click menu picking a row) is gone from
 * the page before any leaving animation could run. This leaves a ghost in its place: a copy of the last frame, marked
 * data-exiting so the leaving keyframes in index.css play on it, inert and click-through, removed once they finish.
 * Every way of closing then animates, without each caller keeping the window mounted while it leaves.
 */

// The longest leaving animation (windows, menus) plus a frame of slack.
const GHOST_MS = 220;

// The parts that carry their own leaving animation (index.css), marked inside the copy as well as on its root.
const LEAVING = '.modal__backdrop, .modal__container, .alert-dialog__backdrop, .alert-dialog__container, .dropdown__popover, .popover';

function ghost(node: HTMLElement) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // Already leaving on its own (react-aria ran the exit): nothing left to show.
  if (node.getAttribute('data-exiting') === 'true') return;
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  const copy = node.cloneNode(true) as HTMLElement;
  for (const part of [copy, ...copy.querySelectorAll<HTMLElement>(LEAVING)]) {
    part.removeAttribute('data-entering');
    part.setAttribute('data-exiting', 'true');
  }
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  copy.style.pointerEvents = 'none';
  // A menu is placed by inline left/top inside its portal; keep it exactly where it was.
  if (getComputedStyle(node).position !== 'fixed') {
    Object.assign(copy.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, margin: '0' });
  }
  document.body.appendChild(copy);
  window.setTimeout(() => copy.remove(), GHOST_MS);
}

/** A ref for an overlay's outermost element: when it unmounts, its ghost plays the leaving animation. */
export function exitGhost<T extends HTMLElement>(also?: (node: T | null) => void | (() => void)): RefCallback<T> {
  return (node) => {
    const cleanup = also?.(node);
    if (!node) return;
    return () => {
      if (typeof cleanup === 'function') cleanup();
      ghost(node);
    };
  };
}
