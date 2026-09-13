// Ads module: network-agnostic placeholders. A real ad SDK needs account
// setup outside this codebase, so these stubs provide the exact integration
// surface (showInterstitialAd / showRewardedAd) that a network drop-in will
// replace later. No external API key is required to run the game.
//
// TODO: swap for real ad SDK (AdSense/AdMob) here — replace the overlay
// implementation inside each function; the call sites stay unchanged.

import { $, el } from './ui.js';

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

export function closeOverlay(result) {
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

// TODO: swap for real ad SDK (AdSense/AdMob) here.
export function showInterstitialAd() {
  const node = el('div', {},
    el('p', { class: 'ad-label', text: 'Ad — thanks for supporting the game' }),
    el('div', { class: 'ad-countdown', text: '3' }),
    el('p', { class: 'sub', text: 'This space is a placeholder. Real ads will appear here once an ad network is connected.' }),
  );
  const box = node;
  let left = 3;
  const timer = setInterval(() => {
    left -= 1;
    const cd = box.querySelector('.ad-countdown');
    if (cd) cd.textContent = String(Math.max(0, left));
    if (left <= 0) {
      clearInterval(timer);
      closeOverlay();
    }
  }, 1000);
  return showOverlay(node);
}

// TODO: swap for real ad SDK (AdSense/AdMob) here.
export function showRewardedAd() {
  let settled = false;
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
              settled = true;
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
  const p = showOverlay(node);
  // Safety net: if the overlay is torn down without a choice, treat as skip.
  p.then(() => { if (!settled) { /* resolved by closeOverlay(false/true) */ } });
  return p;
}
