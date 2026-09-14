// Game screen controller: owns match state, timer, and answer flow.
// Server is authoritative; client only displays and sends actions.
// Diamonds are never computed here — the server returns the new balance.

import { api, getDiamonds, setDiamonds } from '../api.js';
import { $, $$, el, showScreen, fmtClock, fmtMs, toast, spinner } from '../ui.js';
import { renderQuestion, renderOption, typeLabel } from '../render.js';
import { matchTheme, theme } from '../theme.js';

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
};

export function getState() {
  return state;
}

function startTimer() {
  stopTimer();
  state.seconds = 0;
  state.timerInterval = setInterval(() => {
    state.seconds++;
    const t = $('#gameTimer');
    t.textContent = fmtClock(state.seconds);
    if (state.seconds >= 120) t.classList.add('warn');
  }, 1000);
}

function stopTimer() {
  if (state.timerInterval) clearInterval(state.timerInterval);
  state.timerInterval = null;
  const t = $('#gameTimer');
  if (t) { t.textContent = '0:00'; t.classList.remove('warn'); }
}

// Show the themed case briefing before the first clue of a match.
function showIntro(mode, beginFn) {
  const t = matchTheme(mode);
  $('#introKind').textContent = theme.match.modeLabel[mode] ?? 'Case';
  $('#introTitle').textContent = t.title;
  $('#introFlavor').textContent = t.flavor;
  $('#introMeta').textContent = state.puzzles.length
    ? `${state.puzzles.length} ${t.noun}${state.puzzles.length === 1 ? '' : 's'} · one ${t.noun} at a time`
    : '';
  const begin = $('#introBegin');
  begin.textContent = t.begin;
  begin.onclick = () => beginFn();
  showScreen('#screen-intro');
}

function updateEconomyButtons() {
  const balance = getDiamonds();
  const g = theme.screens.game;
  const hintBtn = $('#hintBtn');
  const skipBtn = $('#skipBtn');
  const alreadyAnswered = Boolean(state.answers[state.index]);
  hintBtn.hidden = alreadyAnswered || state.eliminated.length > 0;
  hintBtn.disabled = balance < g.hintCost;
  hintBtn.textContent = `${g.hintButton} (${g.hintCost} 💎)`;
  skipBtn.hidden = alreadyAnswered || state.mode === 'training' || state.skipped >= 1;
  skipBtn.disabled = balance < g.skipCost;
  skipBtn.textContent = `${g.skipButton} (${g.skipCost} 💎)`;
}

export async function startMatch(mode, opts = {}) {
  spinner(true);
  try {
    const path = mode === 'daily' ? '/api/match/daily' : mode === 'quick' ? '/api/match/quick' : mode === 'tournament' ? '/api/tournament/enter' : '/api/match/training';
    const out = await api('POST', path, opts.body ?? {});
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
    sessionStorage.setItem('cra_match', JSON.stringify({ matchId: out.matchId, mode, index: 0 }));
    if (typeof out.diamonds === 'number') setDiamonds(out.diamonds);
    showIntro(mode, () => {
      showScreen('#screen-game');
      renderPuzzle();
    });
    return out;
  } catch (err) {
    if (err.code === 'insufficient_diamonds') toast('Not enough diamonds to enter. Watch an ad on the results screen or play a match to earn more.');
    else if (err.code === 'tournament_already_played') toast(err.detail ?? 'You already played this week\u2019s tournament.');
    else toast(err.detail ?? err.message ?? 'Could not start the match.');
    return null;
  } finally {
    spinner(false);
  }
}

function renderPuzzle() {
  const p = state.puzzles[state.index];
  const t = matchTheme(state.mode);
  $('#gameMode').textContent = theme.match.modeLabel[state.mode] ?? 'Case';
  // Reuse the existing index/length progress state; theme supplies the wording.
  $('#gameProgress').textContent = theme.screens.game.progress(state.index + 1, state.puzzles.length);
  $('#gameType').textContent = typeLabel(p.type);
  $('#gameDiff').textContent = p.difficulty;
  $('#qText').textContent = p.question;

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
}

async function useHint() {
  const g = theme.screens.game;
  const p = state.puzzles[state.index];
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
    markOptions(out.correct, p, out.correctAnswer);
    const fb = $('#feedback');
    fb.className = `feedback ${out.correct ? 'good' : 'bad'}`;
    fb.textContent = out.correct ? `Correct — ${fmtMs(msTaken)}` : `Incorrect — correct answer highlighted. ${out.suspicious ? '(Time flagged for review)' : ''}`;
    const expl = el('span', { class: 'expl', text: out.explanation });
    fb.append(expl);
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
  state.onResults = onResults;
}
