let currentItem = null;
let inputEnabled = true;

let activeLang = 'sp';
let hasTypedAny = false;

let spText = '';
let spTypedBuffer = [];
let spCursorIndex = 0;
let spCharSpans = [];
let spCursorEndEl = null;
let spTokenRanges = [];

let enText = '';
let enTypedBuffer = [];
let enCursorIndex = 0;
let enCharSpans = [];
let enCursorEndEl = null;
let enTokenRanges = [];

let stepPlan = [];
let stepIndex = 0;
let spGroupStart = 0;
let spGroupEnd = 0;
let enGroupStart = 0;
let enGroupEnd = 0;

let durationSeconds = 30;
let timerRunning = false;
let startTs = null;
let timerInterval = null;

let roundCorrect = 0;
let roundTyped = 0;
let roundNonSpace = 0;
let sentencesCompleted = 0;

let osk = null;
let oskClearTimers = new Map();

const el = {
  sentenceMeta: document.getElementById('sentenceMeta'),
  englishTypingBox: document.getElementById('englishTypingBox'),
  typingBox: document.getElementById('typingBox'),
  timeLeft: document.getElementById('timeLeft'),
  timeBar: document.getElementById('timeBar'),
  timeBarFill: document.getElementById('timeBarFill'),
  status: document.getElementById('status'),
  durationPane: document.getElementById('durationPane'),
  newRoundBtn: document.getElementById('newRoundBtn'),
  retryBtn: document.getElementById('retryBtn'),
  resultsDialog: document.getElementById('resultsDialog'),
  cpmValue: document.getElementById('cpmValue'),
  accuracyValue: document.getElementById('accuracyValue'),
  scoreValue: document.getElementById('scoreValue'),
  sentencesValue: document.getElementById('sentencesValue'),
  dialogNew: document.getElementById('dialogNew'),

  lastCpm: document.getElementById('lastCpm'),
  lastAcc: document.getElementById('lastAcc'),
  lastScore: document.getElementById('lastScore'),
  highScore: document.getElementById('highScore'),
  highScoreBanner: document.getElementById('highScoreBanner'),

  osk: document.getElementById('osk'),
};

const DURATION_KEY = 'code_typing_duration_seconds_v1';
const LEARN_HIGHSCORE_KEY_V1 = 'code_typing_learn_highscore_v1';
const LEARN_LASTRESULT_KEY_V1 = 'code_typing_learn_last_result_v1';
const LEARN_HIGHSCORE_KEY = 'code_typing_learn_highscore_wpm_v1';
const LEARN_LASTRESULT_KEY = 'code_typing_learn_last_result_wpm_v1';

function toWpmFromCpm(cpm) {
  const n = Number(cpm);
  if (!Number.isFinite(n)) return 0;
  return n / 5;
}

function setMeta(text) {
  el.sentenceMeta.textContent = text;
}

function setStatus(text) {
  el.status.textContent = text;
}

function setActiveLang(next) {
  activeLang = next === 'en' ? 'en' : 'sp';
  if (activeLang === 'sp') {
    el.typingBox?.focus();
  } else {
    el.englishTypingBox?.focus();
  }
  updateRenderFromBuffers();
}

function computeTokenRanges(text) {
  const ranges = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length });
  }
  return ranges;
}

function tokenCharRange(text, tokenRanges, tokStart, tokEnd) {
  if (!tokenRanges.length) return { start: 0, end: text.length };
  const s = Math.max(0, Math.min(tokenRanges.length - 1, tokStart));
  const e = Math.max(0, Math.min(tokenRanges.length - 1, tokEnd));
  const start = tokenRanges[s].start;
  let end = tokenRanges[e].end;
  if (e + 1 < tokenRanges.length) end = tokenRanges[e + 1].start;
  else end = text.length;
  return { start, end };
}

function buildFallbackAlignment(srcCount, tgtCount) {
  const map = {};
  const denom = Math.max(1, srcCount - 1);
  for (let i = 0; i < srcCount; i += 1) {
    const j = Math.round((i * (tgtCount - 1)) / denom);
    map[String(i)] = [j];
  }
  return map;
}

function buildStepPlanFromAlignment(align) {
  const srcCount = spTokenRanges.length;
  const tgtCount = enTokenRanges.length;
  const alignMap = (align && Object.keys(align).length) ? align : buildFallbackAlignment(srcCount, tgtCount);

  let nextTgtTok = 0;
  const steps = [];

  for (let srcTok = 0; srcTok < srcCount; srcTok += 1) {
    const aligned = Array.isArray(alignMap[String(srcTok)]) ? alignMap[String(srcTok)] : [];
    const filtered = aligned
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x) && x >= nextTgtTok)
      .sort((a, b) => a - b);

    let tgtStart = null;
    let tgtEnd = null;
    if (filtered.length) {
      // Ensure we don't leave gaps in the English side.
      // If the next aligned token is ahead of our next target, start at nextTgtTok.
      tgtStart = Math.min(filtered[0], nextTgtTok);
      tgtEnd = tgtStart;
      for (let k = 1; k < filtered.length; k += 1) {
        if (filtered[k] === tgtEnd + 1) tgtEnd = filtered[k];
        else break;
      }
    } else if (nextTgtTok < tgtCount) {
      tgtStart = nextTgtTok;
      tgtEnd = nextTgtTok;
    }

    if (tgtStart !== null && tgtEnd !== null) {
      nextTgtTok = Math.min(tgtCount, tgtEnd + 1);
    }

    const spRange = tokenCharRange(spText, spTokenRanges, srcTok, srcTok);
    let enRange = { start: enText.length, end: enText.length };
    if (tgtStart !== null && tgtEnd !== null && tgtCount) {
      const s = Math.max(0, Math.min(tgtCount - 1, tgtStart));
      const e = Math.max(0, Math.min(tgtCount - 1, tgtEnd));
      enRange = tokenCharRange(enText, enTokenRanges, s, e);
    }

    steps.push({
      spStart: spRange.start,
      spEnd: spRange.end,
      enStart: enRange.start,
      enEnd: enRange.end,
    });
  }

  // If English has remaining tokens, append them to the final English group.
  if (steps.length && nextTgtTok < tgtCount) {
    const last = steps[steps.length - 1];
    const tail = tokenCharRange(enText, enTokenRanges, nextTgtTok, tgtCount - 1);
    last.enEnd = Math.max(last.enEnd, tail.end);
  }

  return steps;
}

function setCurrentStep(idx) {
  const s = stepPlan[idx];
  if (!s) return;
  spGroupStart = s.spStart;
  spGroupEnd = s.spEnd;
  enGroupStart = s.enStart;
  enGroupEnd = s.enEnd;

  // Ensure cursors don't drift behind group starts.
  if (spCursorIndex < spGroupStart) spCursorIndex = spGroupStart;
  if (enCursorIndex < enGroupStart) enCursorIndex = enGroupStart;
}

function initOnscreenKeyboard() {
  if (!el.osk) return;
  if (osk) return;

  const KeyboardCtor = window.SimpleKeyboard?.default || window.SimpleKeyboard;
  if (!KeyboardCtor) return;

  osk = new KeyboardCtor(el.osk, {
    // Visualization only.
    autoUseTouchEvents: false,
    preventMouseDownDefault: true,
    preventMouseUpDefault: true,
    stopMouseDownPropagation: true,
    stopMouseUpPropagation: true,
    theme: 'hg-theme-default hg-layout-default',
    layout: {
      default: [
        '1 2 3 4 5 6 7 8 9 0 \' ¡ {bksp}',
        'q w e r t y u i o p ` + ç',
        'a s d f g h j k l ñ ´ {enter}',
        '{shift} z x c v b n m , . - {shift}',
        '{space}',
      ],
      shift: [
        '! @ # $ % ^ & ( ) = ? ¿ {bksp}',
        'q w e r t y u i o p ^ * Ç',
        'a s d f g h j k l ñ ¨ {enter}',
        '{shift} z x c v b n m ; : _ {shift}',
        '{space}',
      ],
    },
    display: {
      '{bksp}': '⌫',
      '{enter}': '⏎',
      '{shift}': '⇧',
      '{space}': 'space',
    },
    layoutName: 'default',
  });
}

function setOskLayoutName(name) {
  if (!osk) return;
  try {
    osk.setOptions({ layoutName: name });
  } catch {
    // Ignore.
  }
}

function oskButtonNameForKey(evKey) {
  if (!evKey) return null;
  if (evKey === ' ') return '{space}';
  if (evKey === 'Backspace') return '{bksp}';
  if (evKey === 'Enter') return '{enter}';
  if (evKey === 'Shift') return '{shift}';
  if (evKey.length === 1) return evKey.toLowerCase();
  return null;
}

function flashOskKey(button) {
  if (!osk) return;
  if (!button) return;
  let els;
  try {
    els = osk.getButtonElement(button);
  } catch {
    els = null;
  }
  if (!els) return;

  const list = Array.isArray(els) ? els : [els];
  for (const elBtn of list) {
    if (!elBtn || !elBtn.classList) continue;
    elBtn.classList.add('oskPressed');

    const prev = oskClearTimers.get(elBtn);
    if (prev) clearTimeout(prev);

    const t = setTimeout(() => {
      elBtn.classList.remove('oskPressed');
      oskClearTimers.delete(elBtn);
    }, 140);
    oskClearTimers.set(elBtn, t);
  }
}

function resetTimerUi() {
  el.timeLeft.textContent = `${durationSeconds.toFixed(1)}`;
  setTimeBarPercent(0);
}

function setTimeBarPercent(pct) {
  const p = Math.max(0, Math.min(100, pct));
  if (el.timeBarFill) el.timeBarFill.style.width = `${p.toFixed(1)}%`;
  if (el.timeBar) el.timeBar.setAttribute('aria-valuenow', String(Math.round(p)));
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  timerRunning = false;
  startTs = null;
}

function durationMs() {
  return durationSeconds * 1000;
}

function tick() {
  if (!timerRunning || !startTs) return;
  const now = performance.now();
  const elapsed = now - startTs;
  const remaining = Math.max(0, durationMs() - elapsed);
  el.timeLeft.textContent = (remaining / 1000).toFixed(1);

  // Progress bar starts empty and fills to full as time elapses.
  setTimeBarPercent((elapsed / durationMs()) * 100);

  if (remaining <= 0) {
    stopTimer();
    inputEnabled = false;
    setStatus('Done');
    setTimeBarPercent(100);
    showResults(durationMs());
  }
}

function startAttemptIfNeeded() {
  if (timerRunning) return;
  timerRunning = true;
  startTs = performance.now();
  setStatus('Running');
  timerInterval = setInterval(tick, 50);
}

function computeResults(elapsedMs) {
  const safeElapsedMs = Math.max(1, elapsedMs);
  const elapsedMinutes = safeElapsedMs / 60_000;
  const cpm = Math.round(roundNonSpace / elapsedMinutes);
  const wpm = cpm / 5;
  const accuracy = roundTyped === 0 ? 0 : (roundCorrect / roundTyped) * 100;
  const score = wpm * (accuracy / 100);
  return { wpm, accuracy, score };
}

function getSavedHighScore() {
  const raw = localStorage.getItem(LEARN_HIGHSCORE_KEY);
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return n;

  // Migrate from legacy CPM-based stored value.
  const legacyRaw = localStorage.getItem(LEARN_HIGHSCORE_KEY_V1);
  const legacy = Number(legacyRaw);
  if (!Number.isFinite(legacy) || legacy <= 0) return 0;
  const migrated = toWpmFromCpm(legacy);
  localStorage.setItem(LEARN_HIGHSCORE_KEY, String(migrated));
  return migrated;
}

function setHighScore(value) {
  localStorage.setItem(LEARN_HIGHSCORE_KEY, String(value));
}

function setLastRoundUi({ wpm, accuracy, score }) {
  if (el.lastCpm) el.lastCpm.textContent = Number(wpm).toFixed(1);
  if (el.lastAcc) el.lastAcc.textContent = `${accuracy.toFixed(1)}%`;
  if (el.lastScore) el.lastScore.textContent = Number(score).toFixed(1);
}

function setHighScoreUi(value) {
  if (el.highScore) el.highScore.textContent = value ? Number(value).toFixed(1) : '—';
}

function saveLastResult(result) {
  try {
    localStorage.setItem(LEARN_LASTRESULT_KEY, JSON.stringify(result));
  } catch {
    // Ignore storage errors.
  }
}

function loadLastResult() {
  try {
    const raw = localStorage.getItem(LEARN_LASTRESULT_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return null;
      const wpm = Number(obj.wpm);
      const accuracy = Number(obj.accuracy);
      const score = Number(obj.score);
      if (!Number.isFinite(wpm) || !Number.isFinite(accuracy) || !Number.isFinite(score)) return null;
      return { wpm, accuracy, score };
    }

    // Migrate legacy CPM-based stored result.
    const legacyRaw = localStorage.getItem(LEARN_LASTRESULT_KEY_V1);
    if (!legacyRaw) return null;
    const legacyObj = JSON.parse(legacyRaw);
    if (!legacyObj || typeof legacyObj !== 'object') return null;
    const legacyCpm = Number(legacyObj.cpm);
    const accuracy = Number(legacyObj.accuracy);
    const legacyScore = Number(legacyObj.score);
    if (!Number.isFinite(legacyCpm) || !Number.isFinite(accuracy) || !Number.isFinite(legacyScore)) return null;
    const wpm = toWpmFromCpm(legacyCpm);
    const score = toWpmFromCpm(legacyScore);
    const migrated = { wpm, accuracy, score };
    localStorage.setItem(LEARN_LASTRESULT_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return null;
  }
}

function showResults(elapsedMs) {
  const r = computeResults(elapsedMs);
  el.cpmValue.textContent = Number(r.wpm).toFixed(1);
  el.accuracyValue.textContent = `${r.accuracy.toFixed(1)}%`;
  if (el.scoreValue) el.scoreValue.textContent = Number(r.score).toFixed(1);
  el.sentencesValue.textContent = String(sentencesCompleted);

  setLastRoundUi(r);
  saveLastResult(r);

  const prevHigh = getSavedHighScore();
  const nextHigh = Math.max(prevHigh, r.score);
  if (nextHigh !== prevHigh) setHighScore(nextHigh);
  setHighScoreUi(nextHigh);

  if (el.highScoreBanner) {
    const beat = r.score > prevHigh;
    el.highScoreBanner.classList.toggle('hidden', !beat);
  }

  el.resultsDialog.showModal();
}

function getSavedDurationSeconds() {
  const raw = localStorage.getItem(DURATION_KEY);
  const n = Number(raw);
  if (!Number.isFinite(n)) return 30;
  if (n === 30 || n === 60 || n === 90) return n;
  return 30;
}

function saveDurationSeconds(value) {
  localStorage.setItem(DURATION_KEY, String(value));
}

function setDurationSeconds(next) {
  if (next !== 30 && next !== 60 && next !== 90) return;
  durationSeconds = next;
  saveDurationSeconds(next);
  // Changing duration resets the round.
  startNewRound();
}

function syncDurationUi() {
  const radios = document.querySelectorAll('input[name="duration"]');
  for (const r of radios) {
    r.checked = Number(r.value) === durationSeconds;
  }
  resetTimerUi();
}

function buildSpansForReference(referenceText, containerEl) {
  const spans = [];
  containerEl.textContent = '';

  for (let i = 0; i < referenceText.length; i += 1) {
    const span = document.createElement('span');
    span.className = 'ch';
    if (referenceText[i] === ' ' || referenceText[i] === '\t') {
      span.classList.add('ws');
    }
    span.textContent = referenceText[i];
    spans.push(span);
    containerEl.appendChild(span);
  }

  const endEl = document.createElement('span');
  endEl.className = 'cursorEnd';
  containerEl.appendChild(endEl);
  return { spans, endEl };
}

function renderTypingRow(text, typedBuffer, cursorIdx, spans, endEl, isActive, groupStart, groupEnd) {
  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i];
    span.classList.remove('correct', 'incorrect', 'cursor', 'group');

    if (isActive && Number.isFinite(groupStart) && Number.isFinite(groupEnd)) {
      if (i >= groupStart && i < groupEnd) span.classList.add('group');
    }

    if (typedBuffer[i] !== undefined) {
      if (typedBuffer[i] === text[i]) span.classList.add('correct');
      else span.classList.add('incorrect');
    }
  }

  endEl.style.display = 'none';
  if (!isActive) return;

  if (cursorIdx >= spans.length) {
    endEl.style.display = 'inline-block';
    return;
  }
  spans[cursorIdx].classList.add('cursor');
}

function updateRenderFromBuffers() {
  renderTypingRow(
    spText,
    spTypedBuffer,
    spCursorIndex,
    spCharSpans,
    spCursorEndEl,
    activeLang === 'sp',
    spGroupStart,
    spGroupEnd,
  );
  renderTypingRow(
    enText,
    enTypedBuffer,
    enCursorIndex,
    enCharSpans,
    enCursorEndEl,
    activeLang === 'en',
    enGroupStart,
    enGroupEnd,
  );
}
function updateAlignmentForCurrentSentence(alignPayload) {
  if (!currentItem) return;
  if (alignPayload?.sp_id !== currentItem.sp_id) return;
  currentItem.align = alignPayload.align || {};

  const prevStep = stepIndex;
  stepPlan = buildStepPlanFromAlignment(currentItem.align);
  if (!stepPlan.length) {
    stepPlan = [{ spStart: 0, spEnd: spText.length, enStart: 0, enEnd: enText.length }];
  }
  stepIndex = Math.max(0, Math.min(stepPlan.length - 1, prevStep));
  setCurrentStep(stepIndex);
  advanceIfNeeded();
  updateRenderFromBuffers();
}

async function fetchAlignment(spId) {
  try {
    const payload = await fetchJson(`/api/learn/align?sp_id=${encodeURIComponent(String(spId))}`);
    updateAlignmentForCurrentSentence(payload);
  } catch {
    // Ignore alignment errors; the round can continue without highlighting.
  }
}

function advanceIfNeeded() {
  // Advance through empty groups and switch focus per step:
  // Spanish group -> English group -> next step.
  let guard = 0;
  while (guard < 10) {
    guard += 1;

    if (stepIndex >= stepPlan.length) return;
    const s = stepPlan[stepIndex];
    if (!s) return;

    // Sync group bounds.
    setCurrentStep(stepIndex);

    if (activeLang === 'sp') {
      const done = spCursorIndex >= spGroupEnd || spGroupEnd <= spGroupStart;
      if (!done) return;
      setActiveLang('en');
      continue;
    }

    const done = enCursorIndex >= enGroupEnd || enGroupEnd <= enGroupStart;
    if (!done) return;

    stepIndex += 1;
    if (stepIndex >= stepPlan.length) return;
    setCurrentStep(stepIndex);
    setActiveLang('sp');
  }
}

function finishSentenceIfDone() {
  if (!currentItem) return;
  if (stepIndex < stepPlan.length) return;

  sentencesCompleted += 1;
  if (timerRunning) {
    loadRandomSentence().catch((e) => {
      setMeta(String(e?.message || e));
    });
  }
}

function startSentence(item) {
  currentItem = item;
  inputEnabled = true;
  hasTypedAny = false;

  spText = String(item.spanish || '');
  enText = String(item.english || '');

  spTypedBuffer = [];
  enTypedBuffer = [];
  spCursorIndex = 0;
  enCursorIndex = 0;

  const spRender = buildSpansForReference(spText, el.typingBox);
  spCharSpans = spRender.spans;
  spCursorEndEl = spRender.endEl;

  const enRender = buildSpansForReference(enText, el.englishTypingBox);
  enCharSpans = enRender.spans;
  enCursorEndEl = enRender.endEl;

  spTokenRanges = computeTokenRanges(spText);
  enTokenRanges = computeTokenRanges(enText);

  stepPlan = buildStepPlanFromAlignment(item.align || {});
  if (!stepPlan.length) {
    stepPlan = [{ spStart: 0, spEnd: spText.length, enStart: 0, enEnd: enText.length }];
  }
  stepIndex = 0;
  setCurrentStep(stepIndex);
  spCursorIndex = spGroupStart;
  enCursorIndex = enGroupStart;

  setMeta('');
  if (item.sp_id) fetchAlignment(item.sp_id);

  el.retryBtn.disabled = false;
  setActiveLang('sp');
  advanceIfNeeded();
  updateRenderFromBuffers();
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

async function loadRandomSentence() {
  setMeta('Loading…');
  const data = await fetchJson('/api/learn/random?count=1');
  const items = data.items || [];
  if (!items.length) throw new Error('No sentence pairs available');
  startSentence(items[0]);
}

function startNewRound() {
  stopTimer();
  timerRunning = false;
  startTs = null;
  hasTypedAny = false;
  roundCorrect = 0;
  roundTyped = 0;
  roundNonSpace = 0;
  sentencesCompleted = 0;
  resetTimerUi();
  setStatus('Waiting');
  inputEnabled = true;
  loadRandomSentence().catch((e) => {
    setMeta(String(e?.message || e));
    inputEnabled = false;
    el.retryBtn.disabled = true;
    setStatus('Error');
  });
}

function acceptChar(ch) {
  if (!currentItem) return;
  if (!inputEnabled) return;

  // Ensure we're on a valid step.
  if (!stepPlan.length) return;

  // Start the timer on the first typed character (either language).
  if (!hasTypedAny) {
    hasTypedAny = true;
    startAttemptIfNeeded();
  }

  // Choose active row state.
  const isSp = activeLang === 'sp';
  const text = isSp ? spText : enText;
  const groupStart = isSp ? spGroupStart : enGroupStart;
  const groupEnd = isSp ? spGroupEnd : enGroupEnd;

  let cursor = isSp ? spCursorIndex : enCursorIndex;
  if (cursor < groupStart) cursor = groupStart;
  if (cursor >= groupEnd || cursor >= text.length) {
    // If the current group is already complete, advance and ignore the key.
    if (isSp) spCursorIndex = cursor;
    else enCursorIndex = cursor;
    advanceIfNeeded();
    finishSentenceIfDone();
    updateRenderFromBuffers();
    return;
  }

  const expected = text[cursor];
  roundTyped += 1;
  if (ch === expected) roundCorrect += 1;
  if (!/\s/.test(ch)) roundNonSpace += 1;

  if (isSp) {
    spTypedBuffer[cursor] = ch;
    spCursorIndex = cursor + 1;
  } else {
    enTypedBuffer[cursor] = ch;
    enCursorIndex = cursor + 1;
  }

  advanceIfNeeded();
  finishSentenceIfDone();
  updateRenderFromBuffers();
}

function handleBackspace() {
  if (!currentItem) return;
  if (!inputEnabled) return;

  const isSp = activeLang === 'sp';
  const groupStart = isSp ? spGroupStart : enGroupStart;

  if (isSp) {
    if (spCursorIndex <= groupStart) return;
    spCursorIndex -= 1;
    spTypedBuffer[spCursorIndex] = undefined;
  } else {
    if (enCursorIndex <= groupStart) return;
    enCursorIndex -= 1;
    enTypedBuffer[enCursorIndex] = undefined;
  }

  updateRenderFromBuffers();
}

el.typingBox.addEventListener('click', () => {
  el.typingBox.focus();
});

el.englishTypingBox.addEventListener('click', () => {
  el.englishTypingBox.focus();
});

function handleTypingKeydown(ev) {
  if (!currentItem) return;
  if (!inputEnabled) {
    ev.preventDefault();
    return;
  }

  // Visualize the physical key press.
  flashOskKey(oskButtonNameForKey(ev.key));

  // Show symbol row while Shift is held.
  if (ev.key === 'Shift') {
    setOskLayoutName('shift');
  }

  if (ev.key === ' ') {
    ev.preventDefault();
    acceptChar(' ');
    return;
  }

  if (ev.key === 'Backspace') {
    ev.preventDefault();
    handleBackspace();
    return;
  }

  if (ev.key === 'Enter') {
    ev.preventDefault();
    return;
  }

  if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
    ev.preventDefault();
    acceptChar(ev.key);
  }
}

el.typingBox.addEventListener('keydown', (ev) => {
  handleTypingKeydown(ev);
});

el.englishTypingBox.addEventListener('keydown', (ev) => {
  handleTypingKeydown(ev);
});

// Revert symbol row when Shift is released.
window.addEventListener('keyup', (ev) => {
  if (ev.key === 'Shift') setOskLayoutName('default');
});

el.newRoundBtn.addEventListener('click', () => {
  startNewRound();
});

el.retryBtn.addEventListener('click', () => {
  if (!currentItem) return;
  startSentence(currentItem);
});

el.resultsDialog.addEventListener('close', () => {
  const action = el.resultsDialog.returnValue;
  if (action === 'new') {
    startNewRound();
  }
});

window.addEventListener('load', async () => {
  initOnscreenKeyboard();
  durationSeconds = getSavedDurationSeconds();
  syncDurationUi();

  setHighScoreUi(getSavedHighScore());
  const last = loadLastResult();
  if (last) setLastRoundUi(last);

  const radios = document.querySelectorAll('input[name="duration"]');
  for (const r of radios) {
    r.addEventListener('change', () => {
      if (!r.checked) return;
      setDurationSeconds(Number(r.value));
      syncDurationUi();
    });
  }

  startNewRound();
});
