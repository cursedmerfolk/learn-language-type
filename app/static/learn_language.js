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

let spBoundarySpaceSpans = [];
let enBoundarySpaceSpans = [];

let stepPlan = [];
let stepIndex = 0;
let spGroupStart = 0;
let spGroupEnd = 0;
let enGroupStart = 0;
let enGroupEnd = 0;

// New group-typing state: within each group, we type a sequence of tokens on
// one side, then flip and type the other side.
let activeTokenPos = 0;
let spHighlightMask = null;
let enHighlightMask = null;
let spUnderlineMask = null;
let enUnderlineMask = null;

let durationSeconds = 60;
let timerRunning = false;
let startTs = null;
let timerInterval = null;

let roundCorrect = 0;
let roundTyped = 0;
let roundNonSpace = 0;
let sentencesCompleted = 0;

let osk = null;
let oskClearTimers = new Map();

let datasetItems = null;

const el = {
  sentenceMeta: document.getElementById('sentenceMeta'),
  englishTypingBox: document.getElementById('englishTypingBox'),
  typingBox: document.getElementById('typingBox'),
  timeLeft: document.getElementById('timeLeft'),
  timeBar: document.getElementById('timeBar'),
  timeBarFill: document.getElementById('timeBarFill'),
  status: document.getElementById('status'),
  newRoundBtn: document.getElementById('newRoundBtn'),
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
}

function cleanTokenIdxList(list, maxExclusive) {
  const out = [];
  const seen = new Set();
  const arr = Array.isArray(list) ? list : [];
  for (const raw of arr) {
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    const i = Math.trunc(n);
    if (i < 0 || i >= maxExclusive) continue;
    if (seen.has(i)) continue;
    seen.add(i);
    out.push(i);
  }
  out.sort((a, b) => a - b);
  return out;
}

function buildGroupTokenPlan(groups, spCount, enCount) {
  const plan = [];
  const g = Array.isArray(groups) ? groups : [];
  for (const group of g) {
    plan.push({
      spTokens: cleanTokenIdxList(group?.es, spCount),
      enTokens: cleanTokenIdxList(group?.en, enCount),
    });
  }
  return plan;
}

function tokenMask(textLen, tokenRanges, tokenIdxs) {
  const mask = new Array(textLen).fill(false);
  const idxs = Array.isArray(tokenIdxs) ? tokenIdxs : [];
  for (const t of idxs) {
    const r = tokenRanges[t];
    if (!r) continue;
    const a = Math.max(0, Math.min(textLen, r.start));
    const b = Math.max(0, Math.min(textLen, r.end));
    for (let i = a; i < b; i += 1) mask[i] = true;
  }
  return mask;
}

function updateMasksForCurrentStep() {
  const step = stepPlan[stepIndex];
  if (!step) {
    spHighlightMask = null;
    enHighlightMask = null;
    spUnderlineMask = null;
    enUnderlineMask = null;
    return;
  }

  // Highlight: tokens on the ACTIVE side.
  // Underline: tokens on the OTHER side.
  if (activeLang === 'sp') {
    spHighlightMask = tokenMask(spText.length, spTokenRanges, step.spTokens);
    enHighlightMask = null;
    spUnderlineMask = null;
    enUnderlineMask = tokenMask(enText.length, enTokenRanges, step.enTokens);
  } else {
    spHighlightMask = null;
    enHighlightMask = tokenMask(enText.length, enTokenRanges, step.enTokens);
    spUnderlineMask = tokenMask(spText.length, spTokenRanges, step.spTokens);
    enUnderlineMask = null;
  }
}

function activeTokenRange() {
  const step = stepPlan[stepIndex];
  if (!step) return null;
  const isSp = activeLang === 'sp';
  const list = isSp ? step.spTokens : step.enTokens;
  const tokenIdx = list[activeTokenPos];
  if (!Number.isFinite(tokenIdx)) return null;
  const ranges = isSp ? spTokenRanges : enTokenRanges;
  const r = ranges[tokenIdx];
  if (!r) return null;
  return { start: r.start, end: r.end };
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

function buildAlignFromGroups(groups, srcCount, tgtCount) {
  const mapping = {};
  const g = Array.isArray(groups) ? groups : [];
  for (const group of g) {
    const es = Array.isArray(group?.es) ? group.es : [];
    const en = Array.isArray(group?.en) ? group.en : [];
    const enClean = en
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x) && x >= 0 && x < tgtCount);
    if (!enClean.length) continue;
    for (const iRaw of es) {
      const i = Number(iRaw);
      if (!Number.isFinite(i) || i < 0 || i >= srcCount) continue;
      const k = String(i);
      if (!mapping[k]) mapping[k] = [];
      mapping[k].push(...enClean);
    }
  }

  for (const k of Object.keys(mapping)) {
    mapping[k] = Array.from(new Set(mapping[k]))
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x))
      .sort((a, b) => a - b);
  }
  return mapping;
}

function buildStepPlanFromGroups(groups) {
  const steps = [];
  const g = Array.isArray(groups) ? groups : [];

  for (const group of g) {
    const esIdxs = (Array.isArray(group?.es) ? group.es : [])
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x));
    const enIdxs = (Array.isArray(group?.en) ? group.en : [])
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x));

    let spRange = { start: 0, end: 0 };
    let enRange = { start: 0, end: 0 };

    if (esIdxs.length && spTokenRanges.length) {
      const s = Math.max(0, Math.min(spTokenRanges.length - 1, Math.min(...esIdxs)));
      const e = Math.max(0, Math.min(spTokenRanges.length - 1, Math.max(...esIdxs)));
      spRange = tokenCharRange(spText, spTokenRanges, s, e);
    }

    if (enIdxs.length && enTokenRanges.length) {
      const s = Math.max(0, Math.min(enTokenRanges.length - 1, Math.min(...enIdxs)));
      const e = Math.max(0, Math.min(enTokenRanges.length - 1, Math.max(...enIdxs)));
      enRange = tokenCharRange(enText, enTokenRanges, s, e);
    }

    steps.push({ spStart: spRange.start, spEnd: spRange.end, enStart: enRange.start, enEnd: enRange.end });
  }

  return steps;
}

function buildStepPlanFromAlignment(align) {
  const srcCount = spTokenRanges.length;
  const tgtCount = enTokenRanges.length;
  if (srcCount === 0 && tgtCount === 0) return [];

  const alignMap = (align && Object.keys(align).length) ? align : buildFallbackAlignment(srcCount, tgtCount);

  // Build cleaned src->tgt edges.
  const srcToTgt = new Array(srcCount).fill(null).map(() => []);
  for (let i = 0; i < srcCount; i += 1) {
    const raw = Array.isArray(alignMap[String(i)]) ? alignMap[String(i)] : [];
    const cleaned = raw
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x) && x >= 0 && x < tgtCount);
    // Ensure every source token participates (prevents “dead zones”).
    if (!cleaned.length && tgtCount) {
      const denom = Math.max(1, srcCount - 1);
      const j = Math.round((i * (tgtCount - 1)) / denom);
      srcToTgt[i] = [Math.max(0, Math.min(tgtCount - 1, j))];
    } else {
      srcToTgt[i] = Array.from(new Set(cleaned)).sort((a, b) => a - b);
    }
  }

  // Build tgt->src edges (invert).
  const tgtToSrc = new Array(tgtCount).fill(null).map(() => []);
  for (let i = 0; i < srcCount; i += 1) {
    for (const j of srcToTgt[i]) tgtToSrc[j].push(i);
  }
  for (let j = 0; j < tgtCount; j += 1) {
    tgtToSrc[j] = Array.from(new Set(tgtToSrc[j])).sort((a, b) => a - b);
  }

  // Ensure every target token participates too.
  if (srcCount && tgtCount) {
    for (let j = 0; j < tgtCount; j += 1) {
      if (tgtToSrc[j].length) continue;
      const denom = Math.max(1, tgtCount - 1);
      const i = Math.round((j * (srcCount - 1)) / denom);
      const ii = Math.max(0, Math.min(srcCount - 1, i));
      srcToTgt[ii].push(j);
      srcToTgt[ii] = Array.from(new Set(srcToTgt[ii])).sort((a, b) => a - b);
      tgtToSrc[j] = [ii];
    }
  }

  // Build phrase-like groups as connected components in the bipartite graph.
  const seenSrc = new Array(srcCount).fill(false);
  const seenTgt = new Array(tgtCount).fill(false);
  const groups = [];

  function pushGroup(srcList, tgtList) {
    const srcMin = srcList.length ? Math.min(...srcList) : 0;
    const srcMax = srcList.length ? Math.max(...srcList) : Math.max(0, srcCount - 1);
    const tgtMin = tgtList.length ? Math.min(...tgtList) : 0;
    const tgtMax = tgtList.length ? Math.max(...tgtList) : Math.max(0, tgtCount - 1);
    groups.push({ srcMin, srcMax, tgtMin, tgtMax });
  }

  for (let i0 = 0; i0 < srcCount; i0 += 1) {
    if (seenSrc[i0]) continue;
    const q = [{ t: 's', i: i0 }];
    const srcList = [];
    const tgtList = [];
    seenSrc[i0] = true;

    while (q.length) {
      const cur = q.pop();
      if (cur.t === 's') {
        srcList.push(cur.i);
        for (const j of srcToTgt[cur.i] || []) {
          if (seenTgt[j]) continue;
          seenTgt[j] = true;
          q.push({ t: 't', i: j });
        }
      } else {
        tgtList.push(cur.i);
        for (const i of tgtToSrc[cur.i] || []) {
          if (seenSrc[i]) continue;
          seenSrc[i] = true;
          q.push({ t: 's', i });
        }
      }
    }

    pushGroup(srcList, tgtList);
  }

  // Any remaining unseen targets become singleton-ish groups.
  for (let j0 = 0; j0 < tgtCount; j0 += 1) {
    if (seenTgt[j0]) continue;
    seenTgt[j0] = true;
    const denom = Math.max(1, tgtCount - 1);
    const i = srcCount ? Math.round((j0 * (srcCount - 1)) / denom) : 0;
    pushGroup([Math.max(0, Math.min(srcCount - 1, i))], [j0]);
  }

  // Sort and merge overlapping/adjacent groups in source order.
  groups.sort((a, b) => (a.srcMin - b.srcMin) || (a.tgtMin - b.tgtMin));
  const merged = [];
  for (const g of groups) {
    if (!merged.length) {
      merged.push({ ...g });
      continue;
    }
    const last = merged[merged.length - 1];
    const overlapsSrc = g.srcMin <= last.srcMax + 1;
    const overlapsTgt = g.tgtMin <= last.tgtMax + 1;
    if (overlapsSrc && overlapsTgt) {
      last.srcMin = Math.min(last.srcMin, g.srcMin);
      last.srcMax = Math.max(last.srcMax, g.srcMax);
      last.tgtMin = Math.min(last.tgtMin, g.tgtMin);
      last.tgtMax = Math.max(last.tgtMax, g.tgtMax);
    } else {
      merged.push({ ...g });
    }
  }

  // Convert token groups -> char ranges.
  const steps = [];
  for (const g of merged) {
    const spRange = srcCount
      ? tokenCharRange(spText, spTokenRanges, g.srcMin, g.srcMax)
      : { start: 0, end: spText.length };
    const enRange = tgtCount
      ? tokenCharRange(enText, enTokenRanges, g.tgtMin, g.tgtMax)
      : { start: 0, end: enText.length };
    steps.push({ spStart: spRange.start, spEnd: spRange.end, enStart: enRange.start, enEnd: enRange.end });
  }

  // Ensure we cover full spans at the extremes.
  if (steps.length) {
    steps[0].spStart = 0;
    steps[0].enStart = 0;
    steps[steps.length - 1].spEnd = spText.length;
    steps[steps.length - 1].enEnd = enText.length;
  }

  return steps;
}

function setCurrentStep(idx) {
  // Keep legacy vars for CSS/render compatibility (not used for logic anymore).
  const s = stepPlan[idx];
  if (!s) return;
  spGroupStart = 0;
  spGroupEnd = spText.length;
  enGroupStart = 0;
  enGroupEnd = enText.length;

  updateMasksForCurrentStep();
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

function renderTypingRow(text, typedBuffer, cursorIdx, spans, endEl, isActive, highlightMask, underlineMask) {

  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i];
    span.classList.remove('correct', 'incorrect', 'cursor', 'group', 'xlate');

    if (isActive && highlightMask && highlightMask[i]) {
      span.classList.add('group');
    }

    if (!isActive && underlineMask && underlineMask[i] && !span.classList.contains('ws')) {
      span.classList.add('xlate');
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
    spHighlightMask,
    spUnderlineMask,
  );
  renderTypingRow(
    enText,
    enTypedBuffer,
    enCursorIndex,
    enCharSpans,
    enCursorEndEl,
    activeLang === 'en',
    enHighlightMask,
    enUnderlineMask,
  );
}

function computeTokenBoxes(tokenRanges, charSpans) {
  // Returns { center, width } for each token, relative to #sentenceWrap.
  const wrap = document.getElementById('sentenceWrap');
  if (!wrap) return [];
  const wrapRect = wrap.getBoundingClientRect();
  const boxes = [];

  for (const r of tokenRanges) {
    const startIdx = Math.max(0, Math.min(r.start, charSpans.length - 1));
    const endIdx = Math.max(0, Math.min(r.end - 1, charSpans.length - 1));
    const a = charSpans[startIdx];
    const b = charSpans[endIdx];
    if (!a || !b) {
      boxes.push({ center: wrapRect.width / 2, width: 0 });
      continue;
    }
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    const left = Math.min(ra.left, rb.left);
    const right = Math.max(ra.right, rb.right);
    boxes.push({ center: ((left + right) / 2) - wrapRect.left, width: Math.max(0, right - left) });
  }
  return boxes;
}

function computeBoundaryWhitespaceSpans(referenceText, tokenRanges, charSpans) {
  const spans = [];
  for (let i = 0; i < tokenRanges.length - 1; i += 1) {
    const wsStart = tokenRanges[i].end;
    const span = charSpans[wsStart];
    if (span && /\s/.test(referenceText[wsStart] || '')) spans.push(span);
    else spans.push(null);
  }
  return spans;
}

function resetSpacing(spaceSpans) {
  for (const s of spaceSpans) {
    if (!s) continue;
    s.style.width = '';
    s.style.display = '';
  }
}

function buildTgtToSrcMap(align) {
  const tgtToSrc = {};
  const a = align || {};
  for (const [srcIdxStr, tgtList] of Object.entries(a)) {
    const srcIdx = Number(srcIdxStr);
    if (!Number.isFinite(srcIdx)) continue;
    if (!Array.isArray(tgtList)) continue;
    for (const j of tgtList) {
      const jj = Number(j);
      if (!Number.isFinite(jj)) continue;
      const k = String(jj);
      if (!tgtToSrc[k]) tgtToSrc[k] = [];
      tgtToSrc[k].push(srcIdx);
    }
  }
  return tgtToSrc;
}

function spreadSpanishForEnglish() {
  // Legacy function name kept for callers; now aligns GROUP columns on both rows.
  if (!currentItem) return;
  const groups = Array.isArray(currentItem.groups) ? currentItem.groups : [];
  if (!groups.length) return;
  if (!spTokenRanges.length || !enTokenRanges.length) return;
  if (!spCharSpans.length || !enCharSpans.length) return;

  // Start from default spacing each time (avoid accumulating widths).
  resetSpacing(spBoundarySpaceSpans);
  resetSpacing(enBoundarySpaceSpans);

  spBoundarySpaceSpans = computeBoundaryWhitespaceSpans(spText, spTokenRanges, spCharSpans);
  enBoundarySpaceSpans = computeBoundaryWhitespaceSpans(enText, enTokenRanges, enCharSpans);

  const spBoxes = computeTokenBoxes(spTokenRanges, spCharSpans);
  const enBoxes = computeTokenBoxes(enTokenRanges, enCharSpans);
  if (!spBoxes.length || !enBoxes.length) return;

  function groupWidth(boxes, idxs) {
    if (!idxs.length) return 0;
    let left = Infinity;
    let right = -Infinity;
    for (const i of idxs) {
      const b = boxes[i];
      if (!b) continue;
      const l = b.center - (b.width / 2);
      const r = b.center + (b.width / 2);
      left = Math.min(left, l);
      right = Math.max(right, r);
    }
    if (!Number.isFinite(left) || !Number.isFinite(right)) return 0;
    return Math.max(0, right - left);
  }

  function trailingBoundarySpan(boundarySpans, tokenCount, idxs) {
    if (!idxs.length) return null;
    const endTok = Math.max(...idxs);
    if (!Number.isFinite(endTok)) return null;
    if (endTok < 0 || endTok >= tokenCount - 1) return null;
    return boundarySpans[endTok] || null;
  }

  const MIN_GAP_PX = 14;
  for (let gi = 0; gi < groups.length; gi += 1) {
    const g = groups[gi] || {};
    const spIdxs = (Array.isArray(g.es) ? g.es : [])
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x) && x >= 0 && x < spBoxes.length);
    const enIdxs = (Array.isArray(g.en) ? g.en : [])
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x) && x >= 0 && x < enBoxes.length);

    const spW = groupWidth(spBoxes, spIdxs);
    const enW = groupWidth(enBoxes, enIdxs);
    const desiredContentW = Math.max(spW, enW);
    if (desiredContentW <= 0) continue;

    const spSpan = trailingBoundarySpan(spBoundarySpaceSpans, spBoxes.length, spIdxs);
    const enSpan = trailingBoundarySpan(enBoundarySpaceSpans, enBoxes.length, enIdxs);
    if (!spSpan || !enSpan) continue;

    const spBase = Math.max(0, spSpan.getBoundingClientRect().width || 0);
    const enBase = Math.max(0, enSpan.getBoundingClientRect().width || 0);
    const desiredGap = Math.max(MIN_GAP_PX, spBase, enBase);

    const spExtra = Math.max(0, desiredContentW - spW);
    const enExtra = Math.max(0, desiredContentW - enW);

    if (spExtra > 0.5) {
      spSpan.style.display = 'inline-block';
      spSpan.style.width = `${(desiredGap + spExtra).toFixed(1)}px`;
    } else if (desiredGap > spBase + 0.5) {
      spSpan.style.display = 'inline-block';
      spSpan.style.width = `${desiredGap.toFixed(1)}px`;
    }

    if (enExtra > 0.5) {
      enSpan.style.display = 'inline-block';
      enSpan.style.width = `${(desiredGap + enExtra).toFixed(1)}px`;
    } else if (desiredGap > enBase + 0.5) {
      enSpan.style.display = 'inline-block';
      enSpan.style.width = `${desiredGap.toFixed(1)}px`;
    }
  }
}
function updateAlignmentForCurrentSentence(alignPayload) {
  // No-op: learn-language now uses precomputed `groups` from the dataset.
  void alignPayload;
}

async function fetchAlignment(spId) {
  // No-op: learn-language now reads precomputed groups from the local JSONL dataset.
  void spId;
}

function advanceIfNeeded() {
  // Within a group:
  // - Type all selected tokens on Spanish side (jump token-to-token)
  // - Flip and type all selected tokens on English side
  // - Move to next group
  let guard = 0;
  while (guard < 100) {
    guard += 1;

    if (stepIndex >= stepPlan.length) {
      updateMasksForCurrentStep();
      return;
    }

    const step = stepPlan[stepIndex];
    if (!step) return;

    const isSp = activeLang === 'sp';
    const list = isSp ? step.spTokens : step.enTokens;
    const ranges = isSp ? spTokenRanges : enTokenRanges;

    // If this side has no tokens for the group, flip/advance immediately.
    if (!list.length) {
      activeTokenPos = 0;
      if (isSp) {
        setActiveLang('en');
      } else {
        stepIndex += 1;
        setActiveLang('sp');
      }
      setCurrentStep(stepIndex);
      continue;
    }

    // Clamp token position.
    if (activeTokenPos < 0) activeTokenPos = 0;
    if (activeTokenPos >= list.length) activeTokenPos = list.length - 1;

    const tokenIdx = list[activeTokenPos];
    const r = ranges[tokenIdx];
    if (!r) {
      activeTokenPos += 1;
      continue;
    }

    let cursor = isSp ? spCursorIndex : enCursorIndex;
    if (cursor < r.start) cursor = r.start;

    // Token complete -> jump to next token or flip/advance group.
    if (cursor >= r.end) {
      if (activeTokenPos + 1 < list.length) {
        activeTokenPos += 1;
        const nextR = ranges[list[activeTokenPos]];
        cursor = nextR ? nextR.start : cursor;
        if (isSp) spCursorIndex = cursor;
        else enCursorIndex = cursor;
        continue;
      }

      // Finished all tokens on this side.
      activeTokenPos = 0;
      if (isSp) {
        setActiveLang('en');
        // Place cursor at first English token start.
        const first = step.enTokens[0];
        const firstR = enTokenRanges[first];
        if (firstR) enCursorIndex = firstR.start;
      } else {
        stepIndex += 1;
        setActiveLang('sp');
        const nextStep = stepPlan[stepIndex];
        const first = nextStep?.spTokens?.[0];
        const firstR = spTokenRanges[first];
        if (firstR) spCursorIndex = firstR.start;
      }
      setCurrentStep(stepIndex);
      continue;
    }

    // Persist cursor clamping.
    if (isSp) spCursorIndex = cursor;
    else enCursorIndex = cursor;
    setCurrentStep(stepIndex);
    return;
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

  const esTokens = Array.isArray(item?.es)
    ? item.es.map((x) => String(x))
    : String(item?.spanish || '').split(/\s+/).filter(Boolean);
  const enTokens = Array.isArray(item?.en)
    ? item.en.map((x) => String(x))
    : String(item?.english || '').split(/\s+/).filter(Boolean);

  spText = esTokens.join(' ');
  enText = enTokens.join(' ');

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

  spBoundarySpaceSpans = computeBoundaryWhitespaceSpans(spText, spTokenRanges, spCharSpans);
  enBoundarySpaceSpans = computeBoundaryWhitespaceSpans(enText, enTokenRanges, enCharSpans);

  stepPlan = buildGroupTokenPlan(item.groups || [], spTokenRanges.length, enTokenRanges.length);
  if (!stepPlan.length) {
    stepPlan = [{
      spTokens: cleanTokenIdxList(Array.from({ length: spTokenRanges.length }, (_, i) => i), spTokenRanges.length),
      enTokens: cleanTokenIdxList(Array.from({ length: enTokenRanges.length }, (_, i) => i), enTokenRanges.length),
    }];
  }
  stepIndex = 0;
  activeTokenPos = 0;
  setActiveLang('sp');
  setCurrentStep(stepIndex);
  const firstSp = stepPlan[0]?.spTokens?.[0];
  const firstEn = stepPlan[0]?.enTokens?.[0];
  if (Number.isFinite(firstSp) && spTokenRanges[firstSp]) spCursorIndex = spTokenRanges[firstSp].start;
  else spCursorIndex = 0;
  if (Number.isFinite(firstEn) && enTokenRanges[firstEn]) enCursorIndex = enTokenRanges[firstEn].start;
  else enCursorIndex = 0;

  // Derive an alignment-like mapping for spacing adjustments.
  currentItem.align = buildAlignFromGroups(item.groups || [], spTokenRanges.length, enTokenRanges.length);

  setMeta('');

  advanceIfNeeded();
  updateRenderFromBuffers();

  // Apply spacing immediately using any cached alignment (or none).
  requestAnimationFrame(() => {
    spreadSpanishForEnglish();
  });
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

async function ensureDatasetLoaded() {
  if (Array.isArray(datasetItems) && datasetItems.length) return;
  setMeta('Loading dataset…');
  const res = await fetch('/static/trimmed_sentence_groups.jsonl', { headers: { 'Accept': 'text/plain' } });
  if (!res.ok) throw new Error(`Failed to load dataset (${res.status})`);
  const text = await res.text();
  const items = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try {
      const obj = JSON.parse(s);
      if (!obj || typeof obj !== 'object') continue;
      if (!Array.isArray(obj.es) || !Array.isArray(obj.en) || !Array.isArray(obj.groups)) continue;
      items.push(obj);
    } catch {
      // Ignore bad lines.
    }
  }
  datasetItems = items;
  setMeta(items.length ? `Dataset loaded (${items.length})` : 'Dataset empty');
}

async function loadRandomSentence() {
  await ensureDatasetLoaded();
  if (!datasetItems || !datasetItems.length) throw new Error('Dataset is empty');
  const idx = Math.floor(Math.random() * datasetItems.length);
  startSentence(datasetItems[idx]);
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

  const isSp = activeLang === 'sp';
  const text = isSp ? spText : enText;
  const range = activeTokenRange();
  if (!range) {
    advanceIfNeeded();
    finishSentenceIfDone();
    updateRenderFromBuffers();
    return;
  }

  let cursor = isSp ? spCursorIndex : enCursorIndex;
  if (cursor < range.start) cursor = range.start;
  if (cursor >= range.end || cursor >= text.length) {
    if (isSp) spCursorIndex = cursor;
    else enCursorIndex = cursor;
    advanceIfNeeded();
    finishSentenceIfDone();
    updateRenderFromBuffers();
    return;
  }

  const expected = text[cursor];
  // In this mode we auto-jump between words; don't treat spaces as input.
  if (ch === ' ' && expected !== ' ') return;

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
  const range = activeTokenRange();
  const ranges = isSp ? spTokenRanges : enTokenRanges;
  const step = stepPlan[stepIndex];
  const list = isSp ? step?.spTokens : step?.enTokens;
  if (!range || !Array.isArray(list) || !list.length) return;

  let cursor = isSp ? spCursorIndex : enCursorIndex;
  if (cursor <= range.start) {
    if (activeTokenPos <= 0) return;
    activeTokenPos -= 1;
    const prevR = ranges[list[activeTokenPos]];
    if (prevR) cursor = prevR.end;
  }

  if (cursor <= 0) return;
  cursor -= 1;
  if (isSp) {
    spCursorIndex = cursor;
    spTypedBuffer[spCursorIndex] = undefined;
  } else {
    enCursorIndex = cursor;
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

el.resultsDialog.addEventListener('close', () => {
  const action = el.resultsDialog.returnValue;
  if (action === 'new') {
    startNewRound();
  }
});

window.addEventListener('load', async () => {
  initOnscreenKeyboard();
  setHighScoreUi(getSavedHighScore());
  const last = loadLastResult();
  if (last) setLastRoundUi(last);

  startNewRound();
});
