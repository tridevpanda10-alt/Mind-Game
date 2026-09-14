// Google H5 Games Ads adapter ("Ad Placement API" / AdSense H5 Games Ads).
// Provider id: 'google-h5'. Requires an approved AdSense account and the
// adBreak tag config — see docs/ads-integration.md before enabling.
//
// The Ad Placement API exposes exactly two globals once its script loads:
//   adConfig({ preloadAdBreaks, sound })
//   adBreak({ type, name, beforeAd, afterAd, beforeReward, showAdFn,
//             adDismissed, adViewed, adBreakDone })
// Docs: https://developers.google.com/ad-placement/apis
//
// Key property of the API ("inversion of control"): adBreak() is a request,
// not a command. If no ad is available, NO callbacks fire except
// adBreakDone(), so every flow here must resolve (not hang) via adBreakDone
// and must start a watchdog timer as a belt-and-braces guarantee.

const SCRIPT_URL = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=';

const AD_BREAK_TIMEOUT_MS = 15_000; // if adBreakDone never fires, give up cleanly

let loadPromise = null;

function loadSdk(client) {
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    if (window.adBreak && window.adConfig) return resolve();
    const s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.dataset.adClient = client;
    // Render test ads instead of real inventory while an AdSense account is
    // still unapproved — real inventory would be a policy violation.
    if (window.location.search.includes('adtest=1')) s.dataset.adbreakTest = 'on';
    s.src = SCRIPT_URL + encodeURIComponent(client);
    s.onload = () => resolve();
    s.onerror = () => { loadPromise = null; reject(new Error('ad_sdk_load_failed')); };
    document.head.append(s);
  });
  return loadPromise;
}

// One adBreak() at a time — Google logs a console warning and fails the break
// otherwise. Queue concurrent callers instead of racing.
let inflight = null;
const queue = [];

function runBreak(cfg) {
  return new Promise((resolve) => {
    let done = false;
    // Safety net: the API promises adBreakDone always fires, but a network
    // hiccup must never leave the game frozen behind a half-open promise.
    const watchdog = setTimeout(() => finish('timeout'), AD_BREAK_TIMEOUT_MS);
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(watchdog);
      inflight = null;
      const next = queue.shift();
      if (next) inflight = runBreak(next.cfg).then(next.resolve);
      resolve(result);
    };
    window.adBreak({
      ...cfg,
      adBreakDone: (info) => {
        try { cfg.adBreakDone?.(info); } finally { finish(info?.breakStatus ?? 'done'); }
      },
    });
  });
}

function requestBreak(cfg) {
  if (inflight) return new Promise((resolve) => queue.push({ cfg, resolve }));
  inflight = runBreak(cfg);
  return inflight;
}

export const googleH5Provider = {
  id: 'google-h5',

  async init(config = {}) {
    if (!config.adClient) throw new Error('ads: missing adClient (set AD_CLIENT in env)');
    await loadSdk(config.adClient);
    window.adConfig?.({
      preloadAdBreaks: 'on',
      sound: 'on', // game has no ambient audio; update alongside any audio work
    });
  },

  // type: 'start' — regular interstitial between game moments. May show no ad
  // at all (frequency capping); resolves immediately either way.
  showInterstitialAd() {
    return requestBreak({
      type: 'start',
      name: 'results_interstitial',
      adBreakDone: () => { /* resolved by runBreak via its own wrapper */ },
    }).then(() => {});
  },

  // Resolves true ONLY when the player watched the ad to completion
  // (adViewed). Dismissal, no-fill, and timeout all resolve false — the
  // server still re-validates every reward, so false-positives here cost
  // at most one unfulfilled client intent, never diamonds.
  async showRewardedAd() {
    return new Promise((outerResolve) => {
      let outcome = false; // flips to true only in adViewed
      requestBreak({
        type: 'reward',
        name: 'diamond_reward',
        beforeAd: () => { /* game is turn-based; nothing to pause today */ },
        afterAd: () => { /* nothing to unmute today */ },
        // Called synchronously right after adBreak() IF a rewarded ad is
        // available. We already showed the in-game prompt (the "Watch Ad"
        // button the user just clicked), so start the ad immediately.
        beforeReward: (showAdFn) => showAdFn(),
        adDismissed: () => { outcome = false; },
        adViewed: () => { outcome = true; },
      }).then(() => outerResolve(outcome));
    });
  },
};
