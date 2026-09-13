// Game screen controller: owns match state, timer, and answer flow.
// Server is authoritative; client only displays and sends actions.

import { api } from '../api.js';
import { $, $$, el, showScreen, fmtClock, fmtMs, toast, spinner } from '../ui.js';
import { renderQuestion, renderOption, typeLabel, needsTextInput } from '../render.js';

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

export async function startMatch(mode, opts = {}) {
  spinner(true);
  try {
    const path = mode === 'daily' ? '/api/match/daily' : mode === 'quick' ? '/api/match/quick' : '/api/match/training';
    const out = await api('POST', path, opts.body ?? {});
    if (out.resumed) toast('Resuming your daily attempt.');
    state.matchId = out.matchId;
    state.mode = mode;
    state.puzzles = out.puzzles;
    state.parTimes = out.parTimes ?? [];
    state.index = 0;
    state.answers = [];
    state.finished = false;
    sessionStorage.setItem('cra_match', JSON.stringify({ matchId: out.matchId, mode, index: 0 }));
    showScreen('#screen-game');
    renderPuzzle();
    return out;
  } catch (err) {
    toast(err.detail ?? err.message ?? 'Could not start the match.');
    return null;
  } finally {
    spinner(false);
  }
}

function renderPuzzle() {
  const p = state.puzzles[state.index];
  $('#gameMode').textContent = state.mode === 'daily' ? 'Daily' : state.mode === 'quick' ? 'Quick Match' : 'Training';
  $('#gameProgress').textContent = `${state.index + 1} / ${state.puzzles.length}`;
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
  startTimer();
  state.puzzleStart = performance.now();
}

function selectOption(i) {
  state.selected = i;
  $$('#options .opt').forEach((b, bi) => b.classList.toggle('selected', bi === i));
  $('#submitBtn').disabled = false;
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
  state.onResults = onResults;
}
