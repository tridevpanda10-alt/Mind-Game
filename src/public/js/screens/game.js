// Game screen controller: owns match state, countdown, lives, combo, and the
// answer flow. Server is authoritative — the client only displays server
// values (livesLeft, streak) and sends actions; diamonds are never computed
// here. Juice (animations, sounds, vibration) is presentational only.

import { api, getDiamonds, setDiamonds } from '../api.js';
import { $, $$, el, showScreen, fmtClock, fmtMs, toast, spinner } from '../ui.js';
import { renderQuestion, renderOption, typeLabel } from '../render.js';
import { theme, matchTheme, campaignTheme } from '../theme.js';
import { sfxCorrect, sfxWrong, sfxCombo, vibrate } from '../sfx.js';

const COMBO_THRESHOLD = 3; // first "🔥 Combo!" popup fires at this streak
const REDUCED_MOTION = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const state = {
  matchId: null,
  mode: null,
  puzzles: [],
  parTimes: [],
  index: 0,
  answers: [],
  selected: null,
  puzzleStart: 0,
  timerInterval: null,
  seconds: 0,
  finished: false,
  eliminated: [], // option ids hidden by hints on the current puzzle
  skipped: 0,
  // game-feel pack
  lives: 0, // 0 = no lives mode (training/campaign)
  boss: false,
  streak: 0,
  frozenUntil: 0, // performance.now() timestamp while Freeze Time is active
  freezeActive: false,
};

export function getState() {
  return state;
}

// ── countdown (Phase 4) ────────────────────────────────────────────────────
// Display-only countdown from the puzzle's par time. The server keeps
// recording real msTaken; running out does NOT auto-fail (additive, not
// punitive) — the display just holds at 0 and reads urgent.
function countdownMs() {
  const par = state.parTimes[state.index] ?? 45000;
  // Boss cases run a tighter clock (Phase 5): 60% of par.
  return state.boss ? Math.round(par * 0.6) : par;
}

function startTimer() {
  stopTimer();
  state.seconds = 0;
  state.frozenUntil = 0;
  state.freezeActive = false;
  state.timerEnd = performance.now() + countdownMs();
  const t = $('#gameTimer');
  const bar = $('#timerBar');
  paintTimer(1);
  state.timerInterval = setInterval(() => {
    state.seconds++;
    if (!state.freezeActive) {
      const remainMs = Math.max(0, state.timerEnd - performance.now());
      paintTimer(remainMs / countdownMs(), remainMs);
    }
    if (state.seconds >= 120) t.classList.add('warn');
  }, 250);
}

function paintTimer(ratio, remainMs) {
  const t = $('#gameTimer');
  const bar = $('#timerBar');
  const r = Math.max(0, Math.min(1, ratio ?? 1));
  const secs = Math.ceil((remainMs ?? countdownMs()) / 1000);
  t.textContent = state.freezeActive ? '❄ ' + fmtClock(secs) : fmtClock(secs);
  bar.style.width = `${Math.round(r * 100)}%`;
  t.classList.toggle('t-low', r <= 0.25);
  t.classList.toggle('t-mid', r > 0.25 && r <= 0.55);
  bar.classList.toggle('t-low', r <= 0.25);
  bar.classList.toggle('t-mid', r > 0.25 && r <= 0.55);
}

function stopTimer() {
  if (state.timerInterval) clearInterval(state.timerInterval);
  state.timerInterval = null;
  const t = $('#gameTimer');
  const bar = $('#timerBar');
  if (t) { t.textContent = '0:00'; t.classList.remove('warn', 't-low', 't-mid'); }
  if (bar) { bar.style.width = '100%'; bar.classList.remove('t-low', 't-mid'); }
}

// Freeze Time: 10s pause of the visible countdown (server-validated spend).
async function useFreeze() {
  if (state.freezeActive || state.frozenUntil > performance.now()) return;
  spinner(true);
  try {
    const out = await api('POST', '/api/freeze', { matchId: state.matchId, puzzleIndex: state.index });
    setDiamonds(out.diamondsLeft);
    state.frozenUntil = performance.now() + out.frozenForMs;
    state.freezeActive = true;
    $('#freezeBtn').disabled = true;
    vibrate(20);
    // shift the deadline, then unfreeze when the window elapses
    state.timerEnd += out.frozenForMs;
    setTimeout(() => {
      state.freezeActive = false;
      updateEconomyButtons();
    }, out.frozenForMs);
    toast('Time frozen for 10 seconds.');
  } catch (err) {
    if (err.code === 'insufficient_diamonds') toast('Not enough diamonds to freeze time.');
    else toast(err.detail ?? 'Freeze unavailable.');
  } finally {
    spinner(false);
  }
}

// ── lives (Phase 1) ────────────────────────────────────────────────────────
function renderLives() {
  const wrap = $('#livesWrap');
  wrap.hidden = state.lives <= 0;
  if (!wrap.hidden) {
    wrap.replaceChildren();
    for (let i = 0; i < 3; i++) {
      wrap.append(el('span', { class: `life${i < state.lives ? '' : ' lost'}`, text: i < state.lives ? '❤' : '🖤' }));
    }
  }
}

// ── combo (Phase 2) ────────────────────────────────────────────────────────
function renderStreak() {
  const chip = $('#streakChip');
  if (state.streak >= 2) {
    chip.hidden = false;
    $('#streakCount').textContent = `🔥 ${state.streak}×`;
  } else {
    chip.hidden = true;
  }
}

function comboPopup(streak) {
  const host = $('#comboHost');
  const badge = el('div', { class: 'combo-pop', text: `🔥 ${streak}x Combo!`, 'aria-live': 'polite' });
  host.append(badge);
  setTimeout(() => badge.remove(), 1100);
}

// ── themed intro (unchanged behavior, campaign-aware) ──────────────────────
function showIntro(mode, beginFn, campaignCase = null) {
  const t = mode === 'campaign' ? null : matchTheme(mode);
  const c = campaignTheme();
  $('#introKind').textContent = mode === 'campaign' ? c.modeLabel : theme.match.modeLabel[mode] ?? 'Case';
  if (mode === 'campaign') {
    $('#introTitle').textContent = c.caseLabel(campaignCase.caseNumber);
    $('#introFlavor').textContent = campaignCase.boss ? c.bossBody : c.mapBody;
    $('#introMeta').textContent = `${state.puzzles.length} clues · ${campaignCase.boss ? 'boss case' : `difficulty ≈ ${campaignCase.difficulty}`}`;
    $('#introBegin').textContent = c.beginButton;
    document.querySelector('#screen-intro .intro-card').classList.toggle('boss', campaignCase.boss);
  } else {
    $('#introTitle').textContent = t.title;
    $('#introFlavor').textContent = t.flavor;
    $('#introMeta').textContent = state.puzzles.length
      ? `${state.puzzles.length} ${t.noun}${state.puzzles.length === 1 ? '' : 's'} · one ${t.noun} at a time`
      : '';
    $('#introBegin').textContent = t.begin;
    document.querySelector('#screen-intro .intro-card').classList.remove('boss');
  }
  const begin = $('#introBegin');
  begin.onclick = () => beginFn();
  showScreen('#screen-intro');
}

function updateEconomyButtons() {
  const balance = getDiamonds();
  const g = theme.screens.game;
  const hintBtn = $('#hintBtn');
  const skipBtn = $('#skipBtn');
  const freezeBtn = $('#freezeBtn');
  const alreadyAnswered = Boolean(state.answers[state.index]);
  hintBtn.hidden = alreadyAnswered || state.eliminated.length > 0 || state.boss;
  hintBtn.disabled = balance < g.hintCost;
  hintBtn.textContent = state.boss ? `${g.hintButton} — locked` : `${g.hintButton} (${g.hintCost} 💎)`;
  hintBtn.title = state.boss ? 'Hints are disabled on boss cases.' : (g.hintTooltip ?? '');
  skipBtn.hidden = alreadyAnswered || state.mode === 'training' || state.mode === 'campaign' || state.skipped >= 1;
  skipBtn.disabled = balance < g.skipCost;
  skipBtn.textContent = `${g.skipButton} (${g.skipCost} 💎)`;
  freezeBtn.hidden = alreadyAnswered || state.lives <= 0;
  freezeBtn.disabled = state.freezeActive || balance < 10;
  freezeBtn.textContent = state.freezeActive ? '❄ Frozen' : 'Freeze Time (10 💎)';
}

export async function startMatch(mode, opts = {}) {
  spinner(true);
  try {
    let out;
    if (mode === 'campaign') {
      out = await api('POST', '/api/campaign/start', { caseNumber: opts.caseNumber });
    } else {
      const path = mode === 'daily' ? '/api/match/daily' : mode === 'quick' ? '/api/match/quick' : mode === 'tournament' ? '/api/tournament/enter' : '/api/match/training';
      out = await api('POST', path, opts.body ?? {});
    }
    if (out.resumed) toast('Resuming your attempt.');
    state.matchId = out.matchId;
    state.mode = mode;
    state.puzzles = out.puzzles;
    state.parTimes = out.parTimes ?? [];
    state.index = 0;
    state.answers = [];
    state.finished = false;
    state.eliminated = [];
    state.skipped = 0;
    state.lives = out.lives ?? 0;
    state.boss = Boolean(out.boss);
    state.streak = 0;
    sessionStorage.setItem('cra_match', JSON.stringify({ matchId: out.matchId, mode, index: 0 }));
    if (typeof out.diamonds === 'number') setDiamonds(out.diamonds);
    showIntro(mode, () => {
      showScreen('#screen-game');
      renderPuzzle();
    }, out);
    return out;
  } catch (err) {
    if (err.code === 'insufficient_diamonds') toast('Not enough diamonds to enter. Watch an ad on the results screen or play a match to earn more.');
    else if (err.code === 'tournament_already_played') toast(err.detail ?? 'You already played this week\u2019s tournament.');
    else if (err.code === 'case_locked') toast('Finish the previous case first.');
    else toast(err.detail ?? err.message ?? 'Could not start the match.');
    return null;
  } finally {
    spinner(false);
  }
}

function renderPuzzle() {
  const p = state.puzzles[state.index];
  const ct = campaignTheme();
  $('#failedResultsBtn')?.remove(); // stale fail-outcome button from a previous puzzle/match
  $('#gameMode').textContent = state.mode === 'campaign' ? ct.modeLabel : theme.match.modeLabel[state.mode] ?? 'Case';
  $('#gameMode').classList.toggle('boss-badge', state.boss);
  // Reuse the existing index/length progress state; theme supplies the wording.
  $('#gameProgress').textContent = theme.screens.game.progress(state.index + 1, state.puzzles.length);
  $('#gameType').textContent = typeLabel(p.type);
  $('#gameDiff').textContent = p.difficulty;
  $('#qText').textContent = p.question;

  // Per-difficulty gameplay background (Phase 8): keyed off the puzzle's own
  // difficulty tier; composes with the world-skin layer (different element).
  const stage = $('#gameStage');
  stage.className = 'game-stage';
  stage.dataset.diff = p.difficulty ?? 'medium';

  renderLives();
  renderStreak();

  const vis = $('#qVisual');
  vis.replaceChildren();
  for (const node of renderQuestion(p)) vis.append(node);

  // options
  const optsWrap = $('#options');
  optsWrap.replaceChildren();
  state.selected = null;
  state.eliminated = [];
  p.options.forEach((opt, i) => {
    const btn = el('button', {
      class: 'opt',
      type: 'button',
      onclick: () => selectOption(i),
    });
    btn.append(el('span', { class: 'opt-mark', text: 'ABCD'[i] ?? String(i + 1) }));
    btn.append(renderOption(p, opt, i));
    optsWrap.append(btn);
  });
  $('#answerInputWrap').classList.add('hidden');

  $('#feedback').textContent = '';
  $('#feedback').className = 'feedback';
  $('#submitBtn').hidden = false;
  $('#submitBtn').disabled = true;
  $('#nextBtn').hidden = true;
  $('#finishBtn').hidden = true;
  updateEconomyButtons();
  startTimer();
  state.puzzleStart = performance.now();
}

function selectOption(i) {
  state.selected = i;
  $$('#options .opt').forEach((b, bi) => b.classList.toggle('selected', bi === i));
  $('#submitBtn').disabled = false;
  vibrate(15); // light tap on selection (no-ops without support/disabled)
}

async function useHint() {
  const g = theme.screens.game;
  const p = state.puzzles[state.index];
  if (state.boss) {
    toast('Hints are locked on boss cases.');
    return;
  }
  // Watch an ad to earn the hint when the balance is too low.
  if (getDiamonds() < g.hintCost) {
    toast('Not enough diamonds — watch a short ad instead?');
    const { showRewardedAd, getActiveProviderId } = await import('../ads.js');
    const watched = await showRewardedAd();
    if (!watched) return;
    try {
      const reward = await api('POST', '/api/ad-reward', { provider: getActiveProviderId() });
      setDiamonds(reward.diamonds);
      toast(`+${reward.amount} 💎`);
    } catch (err) {
      toast(err.detail ?? 'Ad reward unavailable right now.');
      return;
    }
  }
  spinner(true);
  try {
    const out = await api('POST', '/api/hint', { matchId: state.matchId, puzzleIndex: state.index });
    setDiamonds(out.diamondsLeft);
    state.eliminated.push(out.eliminate);
    const optId = (o) => String(o.id ?? o);
    $$('#options .opt').forEach((b, bi) => {
      if (optId(p.options[bi]) === String(out.eliminate)) {
        b.classList.add('eliminated');
        b.disabled = true;
        if (state.selected === bi) {
          state.selected = null;
          $('#submitBtn').disabled = true;
        }
      }
    });
    toast('One wrong option eliminated.');
    updateEconomyButtons();
  } catch (err) {
    if (err.code === 'hint_limit_reached') toast('Only one hint per clue.');
    else if (err.code === 'insufficient_diamonds') toast('Not enough diamonds.');
    else if (err.code === 'hints_forbidden_boss') toast('Hints are locked on boss cases.');
    else toast(err.detail ?? 'Hint unavailable.');
  } finally {
    spinner(false);
  }
}

async function useSkip() {
  const g = theme.screens.game;
  spinner(true);
  try {
    const out = await api('POST', '/api/skip', { matchId: state.matchId, puzzleIndex: state.index });
    setDiamonds(out.diamondsLeft);
    state.skipped++;
    state.streak = 0; // skipping breaks the combo (server resets it too)
    renderStreak();
    stopTimer();
    state.answers[state.index] = { correct: false, msTaken: 0, skipped: true };
    const fb = $('#feedback');
    fb.className = 'feedback warn';
    fb.textContent = `Clue skipped (−${g.skipCost} 💎). Scored as incorrect — moving on.`;
    $('#submitBtn').hidden = true;
    const last = state.index === state.puzzles.length - 1;
    if (last) $('#finishBtn').hidden = false;
    else $('#nextBtn').hidden = false;
  } catch (err) {
    if (err.code === 'skip_limit_reached') toast('Only one skip per match.');
    else if (err.code === 'insufficient_diamonds') toast('Not enough diamonds to skip.');
    else toast(err.detail ?? 'Skip unavailable.');
  } finally {
    spinner(false);
  }
}

async function submitCurrent() {
  if (state.selected == null) return;
  const p = state.puzzles[state.index];
  const msTaken = Math.round(performance.now() - state.puzzleStart);
  stopTimer();
  spinner(true);
  try {
    const out = await api('POST', `/api/match/${state.matchId}/answer`, {
      puzzleIndex: state.index,
      answer: String(p.options[state.selected].id ?? p.options[state.selected]),
      msTaken,
    });
    // server-authoritative combo + lives; the client only displays them
    state.streak = out.streak ?? (out.correct ? state.streak + 1 : 0);
    if (typeof out.livesLeft === 'number') state.lives = out.livesLeft;
    renderStreak();
    renderLives();
    markOptions(out.correct, p, out.correctAnswer);
    if (out.correct) {
      sfxCorrect();
      vibrate([15, 40, 15]);
      $('#options .opt.correct')?.classList.add('pop');
    } else {
      sfxWrong();
      vibrate(60);
      $('#options .opt.wrong')?.classList.add('shake');
    }
    if (out.streak === COMBO_THRESHOLD || (out.streak > COMBO_THRESHOLD && out.streak % 2 === 1)) {
      comboPopup(out.streak);
      sfxCombo();
    }
    const fb = $('#feedback');
    fb.className = `feedback ${out.correct ? 'good' : 'bad'}`;
    fb.textContent = out.correct ? `Correct — ${fmtMs(msTaken)}` : `Incorrect — correct answer highlighted. ${out.suspicious ? '(Time flagged for review)' : ''}`;
    const expl = el('span', { class: 'expl', text: out.explanation });
    fb.append(expl);

    // Lives exhausted → the match is over NOW (server finalized it 'failed').
    if (out.matchFailed) {
      $('#submitBtn').hidden = true;
      $('#nextBtn').hidden = true;
      $('#finishBtn').hidden = true;
      const failBtn = el('button', { class: 'btn primary', id: 'failedResultsBtn', text: 'See outcome' });
      failBtn.addEventListener('click', () => showFailedResults());
      $('.game-foot .row.gap')?.before(failBtn);
      toast('Out of lives — the case went cold.');
      return;
    }

    state.answers[state.index] = { correct: out.correct, msTaken };
    $('#submitBtn').hidden = true;
    const last = state.index === state.puzzles.length - 1;
    if (last) $('#finishBtn').hidden = false;
    else $('#nextBtn').hidden = false;
    sessionStorage.setItem('cra_match', JSON.stringify({ matchId: state.matchId, mode: state.mode, index: state.index + 1 }));
  } catch (err) {
    if (err.code === 'already_answered') {
      toast('This puzzle was already submitted. Moving on.');
      advance();
      return;
    }
    if (err.status === 0) {
      toast('Network problem — your answer was not submitted. Retrying keeps your progress.');
      startTimer(); // resume timer; player can retry submit
      return;
    }
    toast(err.detail ?? err.message ?? 'Submission failed.');
    startTimer();
  } finally {
    spinner(false);
  }
}

// Failed outcome (out of lives): pull the honest post-mortem and render the
// themed unsolved verdict with the per-clue breakdown.
async function showFailedResults() {
  spinner(true);
  try {
    const out = await api('GET', `/api/match/${state.matchId}/results`);
    state.finished = true;
    sessionStorage.removeItem('cra_match');
    const { showResults } = await import('./results.js');
    showResults({ ...out, failed: true, score: 0, xpAwarded: 0, diamondsAwarded: 0, ratingAfter: null, ratingBefore: null }, state.mode);
  } catch (err) {
    toast(err.detail ?? 'Could not load the outcome.');
  } finally {
    spinner(false);
  }
}

function markOptions(correct, p, correctAnswer) {
  $$('#options .opt').forEach((b, bi) => {
    b.disabled = true;
    const isChosen = bi === state.selected;
    const optId = String(p.options[bi].id ?? p.options[bi]);
    const correctId = String(correctAnswer ?? '');
    if (isChosen) b.classList.add(correct ? 'correct' : 'wrong');
    if (!correct && optId === correctId) b.classList.add('correct');
  });
}

function advance() {
  if (state.index < state.puzzles.length - 1) {
    state.index++;
    renderPuzzle();
  }
}

async function finish() {
  spinner(true);
  try {
    const out = await api('POST', `/api/match/${state.matchId}/finish`);
    state.finished = true;
    sessionStorage.removeItem('cra_match');
    const { showResults } = await import('./results.js');
    showResults(out, state.mode);
  } catch (err) {
    if (err.code === 'already_finished') {
      toast('Match already finished.');
      sessionStorage.removeItem('cra_match');
      const { goHome } = await import('./home.js');
      goHome();
    } else {
      toast(err.detail ?? err.message ?? 'Could not finish the match.');
    }
  } finally {
    spinner(false);
  }
}

export function exitMatch() {
  stopTimer();
  const m = state.matchId;
  if (m && !state.finished) {
    api('POST', `/api/match/${m}/abandon`).catch(() => {});
  }
  sessionStorage.removeItem('cra_match');
  state.matchId = null;
  showScreen('#screen-home');
}

export function initGame({ onResults }) {
  $('#submitBtn').addEventListener('click', submitCurrent);
  $('#nextBtn').addEventListener('click', advance);
  $('#finishBtn').addEventListener('click', finish);
  $('#exitMatch').addEventListener('click', exitMatch);
  $('#hintBtn').addEventListener('click', useHint);
  $('#skipBtn').addEventListener('click', useSkip);
  $('#freezeBtn').addEventListener('click', useFreeze);
  state.onResults = onResults;
}
