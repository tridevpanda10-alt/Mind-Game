# Ad network integration plan — Mind Game

Current state: **mocked ads** (placeholder overlays, no revenue). The codebase
is already structured for a drop-in real network: a single facade with
swappable providers, server-driven selection, and a server-enforced reward
quota.

## Architecture at a glance

```
screens (game.js, results.js)
   │  showRewardedAd() / showInterstitialAd()   ← public API never changes
   ▼
js/ads.js (facade)
   │  picks provider from GET /api/config → { ads: { provider, adClient } }
   │  ?ads=mock|google-h5|off  (session override for dev/demo)
   ▼
js/ads/mock.js  or  js/ads/google-h5.js      ← provider contract:
   id / init(config) / showInterstitialAd(): Promise<void>
   showRewardedAd(): Promise<boolean>        ← true only on full view
   ▼
POST /api/ad-reward { provider }             ← server: quota + verifyReward()
```

Failure policy: any provider init/flow failure degrades to the mock provider
for the session; the server independently re-validates and quota-limits every
reward, so no client behavior can mint diamonds.

## Provider contract (add a network by adding one file)

A provider is a module exporting:

| Member | Signature | Notes |
|---|---|---|
| `id` | `string` | Used for telemetry + reward verification gate |
| `init(config)` | `Promise<void>` | Load SDK, `adConfig()`. May throw → facade falls back to mock |
| `showInterstitialAd()` | `Promise<void>` | Resolves when the break finishes (or no ad showed) |
| `showRewardedAd()` | `Promise<boolean>` | `true` only when the ad was watched to completion |

Selection lives in `GET /api/config` (`ADS_PROVIDER`, `ADS_CLIENT` env). The
facade never hardcodes a network.

## Network comparison (as of 2026)

| | **Google H5 Games Ads** (AdSense + Ad Placement API) | **AdInPlay** | **GameMonetize / other game networks** |
|---|---|---|---|
| Format fit | Interstitials, prerolls, rewarded — built for H5 web games | Interstitials + rewarded for web games | Varies; often iframe-based portals |
| Signup | AdSense account + site approval needed | Network application | Varies |
| Integration cost | Lowest — one script tag + `adBreak()` calls (adapter already written) | Medium — their JS SDK | Varies |
| Payout terms | AdSense standard (monthly, threshold) | NET-similar | Varies |
| Server-side reward verification | SSV-style callbacks possible via AdSense backend | Some networks offer callbacks / receipts | Rare; often client-only |
| Fit for this repo | **Recommended first** | Backup if AdSense approval stalls | Not recommended |

Google is recommended: it is the same family already stubbed in the code
(`AdSense/AdMob` TODOs), has the smallest diff, and the `adBreak()` model
handles frequency capping for us.

## Google H5 Games Ads — exact steps to go live

1. **AdSense account + site approval.** Sign up at
   [adsense.google.com](https://adsense.google.com), add the deployed domain
   (Render URL or custom domain), pass site review. H5 Games Ads becomes
   available for games once the site is approved.
2. **Get the publisher id** (`ca-pub-XXXXXXXXXXXXXXXX`) from AdSense →
   Settings → Account information.
3. **Set env on the server:**
   ```
   ADS_PROVIDER=google-h5
   ADS_CLIENT=ca-pub-XXXXXXXXXXXXXXXX
   ADS_REWARD_SECRET=<long random string>
   ```
   Deploy. `GET /api/config` now returns the google-h5 provider + client id.
4. **First deploy on test inventory.** With a new AdSense account real
   inventory is not served yet; append `?adtest=1` to the URL (the adapter
   sets `data-adbreak-test="on"`) and confirm in the console that ad breaks
   fire, `adBreakDone` resolves, and rewarded completes map to `true`.
5. **Wire server-side reward verification.** Implement the `TODO(ad-ssv)`
   hook in `verifyReward()` (src/server/index.js): validate the rewarded
   completion via AdSense's server-side verification callback (keyed with
   `ADS_REWARD_SECRET`) or a provider receipt check. Until this returns
   `true`, `/api/ad-reward` refuses real-provider claims with
   `403 ad_reward_unverified` (fail-closed).
6. **Switch off test mode, go live.** Remove `?adtest=1`, watch the first
   real impressions, and monitor `economy_log` (`kind='ad_reward'`) for
   reward flow vs. impressions.
7. **Policy notes (diamonds).** Diamonds must stay non-monetizable:
   no cash-out, no transfer, no exchange for goods — this is already the
   game's stated model, and Google's rewarded-ads policy requires it.

## Alternative networks

If AdSense approval stalls, **AdInPlay** is the common fallback for H5 web
games (interstitials + rewarded, JS SDK). Integration is one new
`js/ads/<provider>.js` file implementing the same contract, plus adding its
id to the allowlist in two places:
- facade `urlProviderOverride()` allowlist (ads.js)
- `ADS_PROVIDER` allowlist + `/api/config` (src/server/index.js)

Then set `ADS_PROVIDER=<new-id>` and deploy.

## What stays mocked

- The **overlay visuals** are the mock provider; a real network renders its
  own full-screen ad UI instead.
- **`verifyReward()`** is a stub returning `true` only for the mock provider
  and `Boolean(ADS_REWARD_SECRET)` otherwise — real SSV validation is the one
  remaining integration task (marked `TODO(ad-ssv)`).
- **Revenue reporting** is out of scope here; AdSense's own dashboard is the
  source of truth.

## Testing the flows today

- `?ads=off` — rewards never claim (facade returns false), interstitials no-op.
- `?ads=mock` — full placeholder flows, server quota still applies.
- `npm test` covers `/api/config` shape, provider allowlist, and the
  fail-closed verifier for `google-h5` without `ADS_REWARD_SECRET`.
