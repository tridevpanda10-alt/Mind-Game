// Results screen: honest post-match summary straight from server payload.
// Case-file framing comes from the theme module, never hardcoded here.
// Game-feel: score counts up, confetti on a solved verdict, shareable card.

import { $, el, showScreen, fmtMs, pct, toast } from '../ui.js';
import { api, setDiamonds } from '../api.js';
import { theme } from '../theme.js';

const REDUCED_MOTION = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function showResults(out, mode) {
  const acc = out.totalCount ? out.correctCount / out.totalCount : 0;
  const failed = Boolean(out.failed);
  const ratingDelta = failed || out.ratingAfter == null || out.ratingBefore == null ? 0 : out.ratingAfter - out.ratingBefore;

  // Failed matches (out of lives) always read the unsolved verdict.
  const verdict = failed
    ? theme.screens.results.unsolvedTitle
    : theme.screens.results.verdict(acc, mode === 'training');
  const verdictClass = failed
    ? 'bad'
    : theme.screens.results.verdictClass(acc, mode === 'training');

  if (typeof out.diamondsAwarded === 'number' && !failed) setDiamonds(out.diamondsAwarded);
  if (out.referralBonus?.paid) {
    // The invite sender gets the bonus; the invited player just sees a note.
    toast('Referral bonus paid to the friend who invited you. Thanks for playing!');
  }

  const hero = el('div', { class: 'card' },
    el('p', { class: `case-verdict ${verdictClass}`, text: verdict }),
    el('p', { class: 'sub', text: theme.screens.results.summaryLine(out.correctCount, out.totalCount) }),
    el('div', { class: 'score-hero' },
      cell('Score', String(out.score ?? 0), true),
      cell('Accuracy', pct(acc)),
      cell('Avg time', fmtMs(out.elapsedMs ? out.elapsedMs / Math.max(1, out.totalCount) : null)),
      failed || mode === 'training' ? cell('XP earned', `+${out.xpAwarded ?? 0}`) : cell('Rating', `${out.ratingAfter ?? '–'}`, false, ratingDelta),
      cell('Diamonds earned', `+${out.diamondsAwarded ?? 0} 💎`),
    ),
    shareRow(out, mode, acc),
  );

  const list = el('div', { class: 'card' });
  for (const r of out.results) {
    list.append(el('div', { class: 'result-row' },
      el('span', { class: 'res-icon', text: r.isCorrect ? '✓' : '✗' }),
      el('div', { class: 'res-body' },
        el('div', {}, el('strong', { text: `${r.type ?? ''}${r.difficulty ? ' · ' + r.difficulty : ''}` }), el('span', { class: 'res-questions', text: `  ${fmtMs(r.msTaken)}` })),
        el('div', { class: 'res-questions', text: `Your answer: ${r.yourAnswer ?? '—'}${r.correctAnswer != null ? ` · Correct: ${r.correctAnswer}` : ''}` }),
        r.explanation ? el('div', { class: 'res-questions', text: r.explanation }) : null,
      ),
    ));
  }

  const extras = el('div', { class: 'card' });
  if (!failed && out.newAchievements?.length) {
    extras.append(el('div', {}, el('strong', { text: `Achievement${out.newAchievements.length > 1 ? 's' : ''} unlocked!` })));
    for (const a of out.newAchievements) extras.append(el('span', { class: 'ach unlocked', text: a }));
  }
  if (!failed && out.campaign?.status === 'completed') {
    extras.append(el('p', { class: 'sub good-text', text: `Case ${out.campaign.caseNumber} closed — Case ${out.campaign.currentCase} is now open on the Case Board.` }));
  }
  if (!failed && out.campaign?.status === 'failed') {
    extras.append(el('p', { class: 'sub', text: `The case stays open — retry Case ${out.campaign.caseNumber} when ready.` }));
  }
  if (!failed && out.newLevel) {
    extras.append(el('p', { class: 'sub', text: `You reached level ${out.newLevel}.` }));
  }
  if (out.referralBonus?.paid) {
    extras.append(el('p', { class: 'sub', text: 'Your inviter received 20 💎 for bringing you on board.' }));
  }

  const body = $('#resultsBody');
  body.replaceChildren(hero, list, extras);

  const deltaEl = document.querySelector('.delta-inline');
  if (deltaEl && mode !== 'training' && !failed) {
    deltaEl.textContent = ratingDelta === 0 ? '±0' : `${ratingDelta > 0 ? '+' : ''}${ratingDelta}`;
    deltaEl.className = ratingDelta >= 0 ? 'delta-up' : 'delta-down';
  }

  showScreen('#screen-results');

  // Juice: count the score up from 0, then confetti on a solved outcome.
  animateScore(hero.querySelector('.score-big'), out.score ?? 0);
  if (!failed && acc * 100 >= theme.screens.results.solvedThresholdPct && mode !== 'training') {
    setTimeout(() => confettiBurst(), 350);
  }

  // Rewarded ad: earn 5 diamonds. The provider (mock or a real network) is
  // chosen by the server via /api/config — this flow is network-agnostic.
  if (!failed) {
    const rewardedBtn = el('button', { class: 'btn', id: 'adRewardBtn', text: 'Watch Ad for +5 💎' });
    rewardedBtn.addEventListener('click', async () => {
      rewardedBtn.disabled = true;
      const { showRewardedAd, getActiveProviderId } = await import('../ads.js');
      const watched = await showRewardedAd();
      if (!watched) {
        rewardedBtn.disabled = false;
        return;
      }
      try {
        const reward = await api('POST', '/api/ad-reward', { provider: getActiveProviderId() });
        setDiamonds(reward.diamonds);
        const line = el('p', { class: 'sub good-text', text: `+${reward.amount} 💎 credited (${reward.remainingToday} ad rewards left today).` });
        rewardedBtn.replaceWith(line);
      } catch (err) {
        if (err.code === 'ad_reward_limit_reached') toast('Daily ad-reward limit reached — back tomorrow!');
        else toast(err.detail ?? 'Could not credit the ad reward.');
        rewardedBtn.disabled = false;
      }
    });
    extras.append(rewardedBtn);

    // Interstitial after the score is visible; non-blocking.
    import('../ads.js').then(({ showInterstitialAd }) => showInterstitialAd());
  }
}

// Count-up animation for the final score (~1s, rAF; instant for
// reduced-motion users).
function animateScore(elm, target) {
  if (!elm) return;
  if (REDUCED_MOTION || !Number.isFinite(target) || target <= 0) {
    elm.textContent = String(target);
    return;
  }
  const t0 = performance.now();
  const DURATION = 1000;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / DURATION);
    const eased = 1 - Math.pow(1 - k, 3); // ease-out cubic
    elm.textContent = String(Math.round(target * eased));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Confetti burst: ~80 pure-CSS animated pieces, auto-removed after ~2.2s,
// non-blocking, disabled under prefers-reduced-motion. No assets/libraries.
function confettiBurst() {
  if (REDUCED_MOTION) return;
  const host = el('div', { class: 'confetti-host', 'aria-hidden': 'true' });
  const COLORS = ['#4cc9f0', '#7b6cf6', '#ffd166', '#4ade80', '#ff5fd2'];
  for (let i = 0; i < 80; i++) {
    const piece = el('span', { class: 'confetti-piece' });
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.background = COLORS[i % COLORS.length];
    piece.style.animationDelay = `${Math.random() * 0.5}s`;
    piece.style.animationDuration = `${1.4 + Math.random() * 0.9}s`;
    piece.style.setProperty('--cx', `${(Math.random() - 0.5) * 220}px`);
    piece.style.setProperty('--rot', `${Math.random() * 900 - 450}deg`);
    if (i % 3 === 0) piece.classList.add('round');
    host.append(piece);
  }
  document.body.append(host);
  setTimeout(() => host.remove(), 2300);
}

// ── Phase 6: shareable score card (client-only canvas + Web Share API) ─────
function shareRow(out, mode, acc) {
  const row = el('div', { class: 'row gap' });
  const btn = el('button', { class: 'btn', type: 'button', text: 'Share score' });
  btn.addEventListener('click', () => shareScore(out, mode, acc, btn));
  row.append(btn);
  return row;
}

const CANVAS_W = 1000;
const CANVAS_H = 525;

function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  return {
    bg: cs.getPropertyValue('--bg').trim() || '#0b0e14',
    card: cs.getPropertyValue('--card').trim() || '#141927',
    text: cs.getPropertyValue('--text').trim() || '#e8ecf4',
    accent: cs.getPropertyValue('--accent').trim() || '#4cc9f0',
    muted: cs.getPropertyValue('--muted').trim() || '#9aa4b2',
  };
}

async function shareScore(out, mode, acc, btn) {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');
  const C = themeColors(); // active skin + scheme drive the card's palette
  const t = theme;

  // background
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  const grad = ctx.createLinearGradient(0, 0, CANVAS_W, CANVAS_H);
  grad.addColorStop(0, hexA(C.accent, 0.16));
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.strokeStyle = hexA(C.accent, 0.55);
  ctx.lineWidth = 4;
  roundRect(ctx, 24, 24, CANVAS_W - 48, CANVAS_H - 48, 28);
  ctx.stroke();

  ctx.fillStyle = C.text;
  ctx.font = '700 46px system-ui, sans-serif';
  ctx.fillText(t.appName, 64, 130);
  ctx.fillStyle = C.muted;
  ctx.font = '400 26px system-ui, sans-serif';
  ctx.fillText(mode === 'training' ? 'Training session' : theme.match.modeLabel[mode] ?? 'Match', 64, 175);

  ctx.fillStyle = C.accent;
  ctx.font = '800 150px system-ui, sans-serif';
  ctx.fillText(String(out.score ?? 0), 64, 340);
  ctx.fillStyle = C.text;
  ctx.font = '600 34px system-ui, sans-serif';
  ctx.fillText(theme.screens.results.summaryLine(out.correctCount, out.totalCount), 64, 400);

  ctx.fillStyle = C.muted;
  ctx.font = '400 24px system-ui, sans-serif';
  ctx.fillText('Server-verified · mind game — reasoning arena', 64, 455);

  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  const text = `I scored ${out.score ?? 0} on ${t.appName}! ${theme.screens.results.summaryLine(out.correctCount, out.totalCount)} Can you beat it?`;
  const url = location.origin === 'null' || location.protocol === 'file:' ? 'https://mind-game.onrender.com' : location.origin;

  // Web Share (with files) where available → share text+URL → copy fallback.
  if (blob && typeof navigator.canShare === 'function') {
    const file = new File([blob], 'mind-game-score.png', { type: 'image/png' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text, title: t.appName, url });
        return;
      } catch { /* user cancelled → fall through to text share */ }
    }
  }
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ text, title: t.appName, url });
      return;
    } catch { /* cancelled → copy fallback */ }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast('Score copied — paste it anywhere!');
  } catch {
    toast('Sharing is not available in this browser.');
  }
  void btn;
  void acc;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function cell(label, value, big = false, delta) {
  const c = el('div', { class: 'chip' },
    el('span', { class: 'chip-label', text: label }),
    el('span', { class: big ? 'score-big' : 'chip-value', text: value }),
  );
  if (delta !== undefined) {
    c.append(el('span', {
      class: delta > 0 ? 'delta-up' : delta < 0 ? 'delta-down' : 'sub',
      text: delta === 0 ? '±0' : `${delta > 0 ? '+' : ''}${delta}`,
    }));
  }
  return c;
}

// '#4cc9f0' + alpha → rgba() (canvas needs explicit rgb for alpha).
function hexA(hex, a) {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}
