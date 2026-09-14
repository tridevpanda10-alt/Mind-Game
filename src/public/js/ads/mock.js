// Mock ad provider: placeholder overlays, no external calls.
// This is the reference implementation of the provider contract (see ../ads.js
// for the interface and ../ads/google-h5.js for the real-network adapter).
//
// Remaining useful in development, in ad-blocker-heavy environments, and as
// the documented fallback whenever a real provider fails or is unconfigured.

import { $, el } from '../ui.js';

function showOverlay(node) {
  return new Promise((resolve) => {
    const host = $('#adOverlay');
    const box = el('div', { class: 'ad-box card', role: 'dialog', 'aria-label': 'Advertisement' });
    box.append(node);
    host.replaceChildren(box);
    host.hidden = false;
    host._resolve = resolve;
  });
}

function closeOverlay(result) {
  const host = $('#adOverlay');
  if (!host.hidden) {
    host.hidden = true;
    host.replaceChildren();
  }
  if (host._resolve) {
    host._resolve(result);
    host._resolve = null;
  }
}

export const mockProvider = {
  id: 'mock',

  showInterstitialAd() {
    const countdown = el('div', { class: 'ad-countdown', text: '3' });
    const node = el('div', {},
      el('p', { class: 'ad-label', text: 'Ad — thanks for supporting the game' }),
      countdown,
      el('p', { class: 'sub', text: 'This space is a placeholder. Real ads will appear here once an ad network is connected.' }),
    );
    let left = 3;
    const timer = setInterval(() => {
      left -= 1;
      const cd = node.querySelector('.ad-countdown');
      if (cd) cd.textContent = String(Math.max(0, left));
      if (left <= 0) {
        clearInterval(timer);
        closeOverlay();
      }
    }, 1000);
    return showOverlay(node);
  },

  showRewardedAd() {
    let timer = null;
    let left = 5;
    const countdown = el('div', { class: 'ad-countdown', text: '5' });
    const node = el('div', {},
      el('p', { class: 'ad-label', text: 'Ad — watch to earn a reward' }),
      countdown,
      el('p', { class: 'sub', text: 'Placeholder rewarded ad. Watch to the end to earn diamonds.' }),
      el('div', { class: 'row gap' },
        el('button', {
          class: 'btn primary',
          type: 'button',
          text: 'Watch Ad',
          onclick: () => {
            if (timer) return; // already watching
            timer = setInterval(() => {
              left -= 1;
              countdown.textContent = String(Math.max(0, left));
              if (left <= 0) {
                clearInterval(timer);
                closeOverlay(true);
              }
            }, 1000);
          },
        }),
        el('button', {
          class: 'btn ghost',
          type: 'button',
          text: 'Skip',
          onclick: () => closeOverlay(false),
        }),
      ),
    );
    return showOverlay(node);
  },
};
