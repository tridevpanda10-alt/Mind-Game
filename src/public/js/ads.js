// Ads facade: the ONLY module other screens import for ads.
// Public API (unchanged since the placeholder days, so call sites never move):
//   showInterstitialAd(): Promise<void>
//   showRewardedAd(): Promise<boolean>   // true only if watched to completion
//
// Provider selection is server-driven: GET /api/config returns
//   { ads: { provider: 'mock' | 'google-h5' | 'off', adClient: string|null } }
// so switching networks is an env change + deploy, not a client release.
// `?ads=mock|google-h5|off` on the URL overrides for the session (dev/demo).
//
// Every real provider implements the same tiny contract (see ads/mock.js and
// ads/google-h5.js):
//   id: string
//   async init(config): Promise<void>      // may throw; caller falls back
//   showInterstitialAd(): Promise<void>
//   showRewardedAd(): Promise<boolean>
//
// Failure policy: if the selected provider fails to init or throws mid-flow,
// we degrade to the mock provider for the rest of the session rather than
// breaking the game. Diamond rewards are ALWAYS credited server-side
// (POST /api/ad-reward), so no client failure can mint diamonds.

import { api } from './api.js';
import { mockProvider } from './ads/mock.js';

let provider = null;          // set once initAds() settles
let initPromise = null;

const offProvider = {
  id: 'off',
  async init() {},
  async showInterstitialAd() {},
  async showRewardedAd() { return false; },
};

function urlProviderOverride() {
  const v = new URLSearchParams(window.location.search).get('ads');
  return ['mock', 'google-h5', 'off'].includes(v) ? v : null;
}

async function resolveProvider() {
  const override = urlProviderOverride();
  let providerId = 'mock';
  let adClient = null;
  if (override) {
    providerId = override;
  } else {
    try {
      const cfg = await api('GET', '/api/config');
      providerId = cfg.ads?.provider ?? 'mock';
      adClient = cfg.ads?.adClient ?? null;
    } catch {
      // /api/config unreachable (offline shell load): stay on the safe mock.
    }
  }

  if (providerId === 'off') return offProvider;
  if (providerId === 'google-h5') {
    try {
      const { googleH5Provider } = await import('./ads/google-h5.js');
      await googleH5Provider.init({ adClient });
      return googleH5Provider;
    } catch (err) {
      console.warn('[ads] google-h5 unavailable, falling back to mock:', err?.message ?? err);
      return mockProvider;
    }
  }
  return mockProvider;
}

function ensureProvider() {
  if (!initPromise) {
    initPromise = resolveProvider().then((p) => { provider = p; return p; });
  }
  return initPromise;
}

// Optional explicit init (called from app.js boot); not required — the
// show* functions lazily initialize on first use.
export function initAds() {
  return ensureProvider();
}

export function getActiveProviderId() {
  return provider?.id ?? 'pending';
}

export async function showInterstitialAd() {
  const p = await ensureProvider();
  try {
    return await p.showInterstitialAd();
  } catch (err) {
    console.warn('[ads] interstitial failed, using mock:', err?.message ?? err);
    provider = mockProvider;
    return mockProvider.showInterstitialAd();
  }
}

export async function showRewardedAd() {
  const p = await ensureProvider();
  try {
    return await p.showRewardedAd();
  } catch (err) {
    console.warn('[ads] rewarded failed, using mock:', err?.message ?? err);
    provider = mockProvider;
    return mockProvider.showRewardedAd();
  }
}
