// Results screen: honest post-match summary straight from server payload.
// Case-file framing comes from the theme module, never hardcoded here.

import { $, el, showScreen, fmtMs, pct, toast } from '../ui.js';
import { api, setDiamonds } from '../api.js';
import { matchTheme, theme } from '../theme.js';

export function showResults(out, mode) {
  const t = matchTheme(mode);
  const acc = out.totalCount ? out.correctCount / out.totalCount : 0;
  const ratingDelta = out.ratingAfter - out.ratingBefore;

  // Case verdict from the theme module (thresholds live there, not here).
  const verdict = theme.screens.results.verdict(acc, mode === 'training');
  const verdictClass = theme.screens.results.verdictClass(acc, mode === 'training');

  if (typeof out.diamondsAwarded === 'number') setDiamonds(out.diamondsAwarded);
  if (out.referralBonus?.paid) {
    // The invite sender gets the bonus; the invited player just sees a note.
    toast('Referral bonus paid to the friend who invited you. Thanks for playing!');
  }

  const hero = el('div', { class: 'card' },
    el('p', { class: `case-verdict ${verdictClass}`, text: verdict }),
    el('div', { class: 'score-hero' },
      cell('Score', String(out.score), true),
      cell('Accuracy', pct(acc)),
      cell('Avg time', fmtMs(out.elapsedMs ? out.elapsedMs / Math.max(1, out.totalCount) : null)),
      mode === 'training' ? cell('XP earned', `+${out.xpAwarded}`) : cell('Rating', `${out.ratingAfter}`, false, ratingDelta),
      cell('Diamonds earned', `+${out.diamondsAwarded ?? 0} 💎`),
    ),
  );

  const list = el('div', { class: 'card' });
  for (const r of out.results) {
    list.append(el('div', { class: 'result-row' },
      el('span', { class: 'res-icon', text: r.isCorrect ? '✓' : '✗' }),
      el('div', { class: 'res-body' },
        el('div', {}, el('strong', { text: `${r.type} · ${r.difficulty}` }), el('span', { class: 'res-questions', text: `  ${fmtMs(r.msTaken)}` })),
        el('div', { class: 'res-questions', text: `Your answer: ${r.yourAnswer ?? '—'} · Correct: ${r.correctAnswer}` }),
        el('div', { class: 'res-questions', text: r.explanation }),
      ),
    ));
  }

  const extras = el('div', { class: 'card' });
  if (out.newAchievements?.length) {
    extras.append(el('div', {}, el('strong', { text: `Achievement${out.newAchievements.length > 1 ? 's' : ''} unlocked!` })));
    for (const a of out.newAchievements) extras.append(el('span', { class: 'ach unlocked', text: a }));
  }
  if (out.newLevel) {
    extras.append(el('p', { class: 'sub', text: `You reached level ${out.newLevel}.` }));
  }
  if (out.referralBonus?.paid) {
    extras.append(el('p', { class: 'sub', text: 'Your inviter received 20 💎 for bringing you on board.' }));
  }

  const body = $('#resultsBody');
  body.replaceChildren(hero, list, extras);

  const deltaEl = document.querySelector('.delta-inline');
  if (deltaEl && mode !== 'training') {
    deltaEl.textContent = ratingDelta === 0 ? '±0' : `${ratingDelta > 0 ? '+' : ''}${ratingDelta}`;
    deltaEl.className = ratingDelta >= 0 ? 'delta-up' : 'delta-down';
  }

  showScreen('#screen-results');

  // Placeholder rewarded ad: earn 5 diamonds instead of a paid hint shortcut.
  // TODO: swap for real ad SDK (AdSense/AdMob) here — the flow stays identical.
  const rewardedBtn = el('button', { class: 'btn', id: 'adRewardBtn', text: 'Watch Ad for +5 💎' });
  rewardedBtn.addEventListener('click', async () => {
    rewardedBtn.disabled = true;
    const { showRewardedAd } = await import('../ads.js');
    const watched = await showRewardedAd();
    if (!watched) {
      rewardedBtn.disabled = false;
      return;
    }
    try {
      const reward = await api('POST', '/api/ad-reward', {});
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

  // Placeholder interstitial after the score is visible; non-blocking.
  import('../ads.js').then(({ showInterstitialAd }) => showInterstitialAd());
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
