let currentItem = null;
let inputEnabled = true;
let typedBuffer = [];
let cursorIndex = 0;
let charSpans = [];
let cursorEndEl = null;
let srcTokenRanges = [];
let tgtTokenSpans = [];
let englishAligned = false;
let boundarySpaceSpans = [];

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
  englishBox: document.getElementById('englishBox'),
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

function buildSpansForReference(referenceText) {
  charSpans = [];
  el.typingBox.textContent = '';

  for (let i = 0; i < referenceText.length; i += 1) {
    const span = document.createElement('span');
    span.className = 'ch';
    if (referenceText[i] === ' ' || referenceText[i] === '\t') {
      span.classList.add('ws');
    }
    span.textContent = referenceText[i];
    charSpans.push(span);
    el.typingBox.appendChild(span);
  }

  cursorEndEl = document.createElement('span');
  cursorEndEl.className = 'cursorEnd';
  el.typingBox.appendChild(cursorEndEl);
}

function updateCursorVisual() {
  for (const s of charSpans) s.classList.remove('cursor');
  if (!currentItem) return;

  if (cursorIndex >= charSpans.length) {
    cursorEndEl.style.display = 'inline-block';
    return;
  }

  cursorEndEl.style.display = 'none';
  charSpans[cursorIndex].classList.add('cursor');
}

function updateRenderFromBuffer() {
  if (!currentItem) return;
  const referenceText = currentItem.spanish;

  for (let i = 0; i < charSpans.length; i += 1) {
    const span = charSpans[i];
    span.classList.remove('correct', 'incorrect');

    if (i < typedBuffer.length) {
      if (typedBuffer[i] === referenceText[i]) {
        span.classList.add('correct');
      } else {
        span.classList.add('incorrect');
      }
    }
  }

  updateCursorVisual();
  updateEnglishHighlight();
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

function renderEnglishTokens(tokens) {
  tgtTokenSpans = [];
  el.englishBox.textContent = '';
  englishAligned = false;

  for (let i = 0; i < tokens.length; i += 1) {
    if (i > 0) el.englishBox.appendChild(document.createTextNode(' '));
    const span = document.createElement('span');
    span.className = 'tok';
    span.textContent = tokens[i];
    tgtTokenSpans.push(span);
    el.englishBox.appendChild(span);
  }
}

function computeSpanishTokenBoxes() {
  // Returns { center, width } for each Spanish token, relative to sentenceWrap.
  const wrap = document.getElementById('sentenceWrap');
  if (!wrap) return [];
  const wrapRect = wrap.getBoundingClientRect();
  const boxes = [];

  for (const r of srcTokenRanges) {
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

function computeBoundaryWhitespaceSpans(referenceText) {
  // For each boundary between Spanish tokens i and i+1, pick the first whitespace
  // span right after token i. We'll widen that span to push subsequent words.
  const spans = [];
  for (let i = 0; i < srcTokenRanges.length - 1; i += 1) {
    const wsStart = srcTokenRanges[i].end;
    const span = charSpans[wsStart];
    if (span && /\s/.test(referenceText[wsStart] || '')) {
      spans.push(span);
    } else {
      spans.push(null);
    }
  }
  return spans;
}

function resetSpanishSpacing() {
  for (const s of boundarySpaceSpans) {
    if (!s) continue;
    s.style.width = '';
    s.style.display = '';
  }
}

function spreadSpanishForEnglish() {
  if (!currentItem) return;
  if (!currentItem.align || Object.keys(currentItem.align).length === 0) return;
  if (!tgtTokenSpans.length) return;

  // Start from default spacing each time (avoid accumulating widths).
  resetSpanishSpacing();

  const ref = currentItem.spanish;
  boundarySpaceSpans = computeBoundaryWhitespaceSpans(ref);

  const boxes = computeSpanishTokenBoxes();
  if (!boxes.length) return;

  const tgtToSrc = buildTgtToSrcMap(currentItem.align);
  const englishWidths = tgtTokenSpans.map((s) => s.getBoundingClientRect().width);

  // For each Spanish token, compute the max width of aligned English tokens.
  const maxEnBySrc = new Array(boxes.length).fill(0);
  for (let j = 0; j < englishWidths.length; j += 1) {
    const srcList = tgtToSrc[String(j)] || [];
    if (!srcList.length) continue;
    const w = englishWidths[j] || 0;
    for (const i of srcList) {
      if (i >= 0 && i < maxEnBySrc.length) {
        maxEnBySrc[i] = Math.max(maxEnBySrc[i], w);
      }
    }
  }

  // Larger pad/gap means we allocate more horizontal room for English tokens.
  const baseGap = 18;
  const pad = 18;
  const desiredWidth = boxes.map((b, i) => Math.max(b.width, maxEnBySrc[i] + pad));

  // Compute target centers (greedy) so desired token boxes don't overlap.
  const targetCenters = new Array(boxes.length).fill(0);
  targetCenters[0] = boxes[0].center;
  for (let i = 1; i < boxes.length; i += 1) {
    const prev = targetCenters[i - 1];
    const delta = (desiredWidth[i - 1] / 2) + (desiredWidth[i] / 2) + baseGap;
    targetCenters[i] = prev + delta;
  }

  // Normalize to keep the sentence roughly centered.
  const natFirst = boxes[0].center;
  const natLast = boxes[boxes.length - 1].center;
  const tgtFirst = targetCenters[0];
  const tgtLast = targetCenters[targetCenters.length - 1];
  const natMid = (natFirst + natLast) / 2;
  const tgtMid = (tgtFirst + tgtLast) / 2;
  const shiftAll = natMid - tgtMid;
  for (let i = 0; i < targetCenters.length; i += 1) {
    targetCenters[i] += shiftAll;
  }

  // Compute per-boundary extra spacing needed and apply to whitespace spans.
  const shifts = boxes.map((b, i) => targetCenters[i] - b.center);
  // Apply extra spacing more aggressively to reduce English wrapping.
  const spreadFactor = 1.6;

  for (let i = 0; i < boundarySpaceSpans.length; i += 1) {
    const span = boundarySpaceSpans[i];
    if (!span) continue;

    const deltaShift = (shifts[i + 1] ?? 0) - (shifts[i] ?? 0);
    const extra = Math.max(0, deltaShift) * spreadFactor;
    if (extra <= 0.5) continue;

    const rect = span.getBoundingClientRect();
    const baseW = Math.max(2, rect.width || 0);
    span.style.display = 'inline-block';
    span.style.width = `${(baseW + extra).toFixed(1)}px`;
  }
}

function computeSpanishTokenCenters() {
  // Returns x-centers (in px) for each Spanish token, relative to sentenceWrap.
  const wrap = document.getElementById('sentenceWrap');
  if (!wrap) return [];
  const wrapRect = wrap.getBoundingClientRect();
  const centers = [];

  for (const r of srcTokenRanges) {
    const startIdx = Math.max(0, Math.min(r.start, charSpans.length - 1));
    const endIdx = Math.max(0, Math.min(r.end - 1, charSpans.length - 1));
    const a = charSpans[startIdx];
    const b = charSpans[endIdx];
    if (!a || !b) {
      centers.push(wrapRect.width / 2);
      continue;
    }
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    const left = Math.min(ra.left, rb.left);
    const right = Math.max(ra.right, rb.right);
    centers.push(((left + right) / 2) - wrapRect.left);
  }

  return centers;
}

function buildTgtToSrcMap(align) {
  const tgtToSrc = {};
  const a = align || {};
  for (const [srcIdxStr, tgtList] of Object.entries(a)) {
    const srcIdx = Number(srcIdxStr);
    if (!Number.isFinite(srcIdx)) continue;
    if (!Array.isArray(tgtList)) continue;
    for (const j of tgtList) {
      if (!Number.isFinite(j)) continue;
      const k = String(j);
      if (!tgtToSrc[k]) tgtToSrc[k] = [];
      tgtToSrc[k].push(srcIdx);
    }
  }
  return tgtToSrc;
}

function layoutEnglishTokensAligned() {
  if (!currentItem) return;
  if (!tgtTokenSpans.length) return;
  if (!currentItem.align || Object.keys(currentItem.align).length === 0) return;

  const wrap = document.getElementById('sentenceWrap');
  if (!wrap) return;
  const wrapRect = wrap.getBoundingClientRect();
  const containerW = wrapRect.width;
  if (containerW <= 0) return;

  const centers = computeSpanishTokenBoxes().map((b) => b.center);
  const tgtToSrc = buildTgtToSrcMap(currentItem.align);

  // Re-render English without spaces so we can absolutely position each token.
  el.englishBox.textContent = '';
  for (const span of tgtTokenSpans) {
    span.style.position = 'absolute';
    span.style.left = '0px';
    span.style.top = '0px';
    // We'll position by left edge (not centered) to avoid a rigid column look.
    span.style.transform = 'none';
    span.style.whiteSpace = 'nowrap';
    span.style.visibility = 'hidden';
    el.englishBox.appendChild(span);
  }

  const tokenWidths = tgtTokenSpans.map((s) => s.getBoundingClientRect().width);

  const items = tgtTokenSpans.map((span, j) => {
    const srcList = tgtToSrc[String(j)] || [];
    let x;
    if (srcList.length) {
      let sum = 0;
      let n = 0;
      for (const i of srcList) {
        if (i >= 0 && i < centers.length) {
          sum += centers[i];
          n += 1;
        }
      }
      x = n ? (sum / n) : null;
    } else {
      x = null;
    }

    // Fallback: distribute across the container.
    if (x === null) {
      const denom = Math.max(1, tgtTokenSpans.length - 1);
      x = (containerW * (j / denom));
    }

    const w = tokenWidths[j] || 0;
    const desiredLeft = x - (w / 2);
    return { j, x, desiredLeft, w };
  });

  items.sort((a, b) => a.x - b.x);

  const lineHeight = 20;
  const gap = 6;

  // Try to lay out on a single row by letting tokens shift
  // to avoid overlaps (flow-like layout).
  const placements = new Array(tgtTokenSpans.length).fill(null);
  let prevRight = 0;
  let minLeft = Infinity;
  let maxRight = -Infinity;

  for (const it of items) {
    const w = it.w || 0;
    let left = it.desiredLeft;
    left = Math.max(0, Math.min(containerW - w, left));
    left = Math.max(left, prevRight + gap);
    const right = left + w;
    placements[it.j] = { left, top: 0, w };
    prevRight = right;
    minLeft = Math.min(minLeft, left);
    maxRight = Math.max(maxRight, right);
  }

  // If we overflow the container, shift the whole row left as much as possible.
  if (Number.isFinite(minLeft) && maxRight > containerW) {
    const overflow = maxRight - containerW;
    const shift = Math.min(overflow, minLeft);
    if (shift > 0) {
      for (let j = 0; j < placements.length; j += 1) {
        if (!placements[j]) continue;
        placements[j].left -= shift;
      }
      minLeft -= shift;
      maxRight -= shift;
    }
  }

  // Still overflow? Fall back to multi-row packing (but not rigid columns).
  if (maxRight > containerW) {
    const lineRight = [];
    for (const it of items) {
      const w = it.w || 0;
      let placedLine = 0;
      while (placedLine < lineRight.length) {
        const candidateLeft = Math.max(0, lineRight[placedLine] + gap);
        // If it doesn't fit on this line, try the next line.
        if (candidateLeft + w <= containerW) break;
        placedLine += 1;
      }
      if (placedLine === lineRight.length) lineRight.push(0);

      const baseLeft = Math.max(0, Math.min(containerW - w, it.desiredLeft));
      const left = Math.max(baseLeft, lineRight[placedLine] + gap);
      const right = left + w;
      lineRight[placedLine] = Math.max(lineRight[placedLine], right);
      placements[it.j] = { left, top: placedLine * lineHeight, w };
    }
    el.englishBox.style.height = `${Math.max(1, lineRight.length) * lineHeight}px`;
  } else {
    el.englishBox.style.height = `${lineHeight}px`;
  }

  for (let j = 0; j < placements.length; j += 1) {
    const p = placements[j];
    if (!p) continue;
    const span = tgtTokenSpans[j];
    span.style.left = `${p.left.toFixed(1)}px`;
    span.style.top = `${p.top.toFixed(1)}px`;
    span.style.visibility = 'visible';
  }

  englishAligned = true;
}

function updateAlignmentForCurrentSentence(alignPayload) {
  if (!currentItem) return;
  if (alignPayload?.sp_id !== currentItem.sp_id) return;
  currentItem.align = alignPayload.align || {};
  // Prefer aligner's tokens if provided.
  if (Array.isArray(alignPayload.tgt_tokens)) {
    currentItem.tgt_tokens = alignPayload.tgt_tokens;
    renderEnglishTokens(currentItem.tgt_tokens);
  }
  // First widen Spanish spacing to reduce English wrapping,
  // then position English tokens.
  spreadSpanishForEnglish();
  layoutEnglishTokensAligned();
  updateEnglishHighlight();
}

async function fetchAlignment(spId) {
  try {
    const payload = await fetchJson(`/api/learn/align?sp_id=${encodeURIComponent(String(spId))}`);
    updateAlignmentForCurrentSentence(payload);
  } catch {
    // Ignore alignment errors; the round can continue without highlighting.
  }
}

function getActiveSrcTokenIndex() {
  if (!currentItem) return null;
  const ref = currentItem.spanish;

  // Prefer the current cursor position (the next character to type).
  // This makes highlighting visible immediately (even before typing).
  let pos = Math.min(Math.max(0, cursorIndex), Math.max(0, ref.length - 1));

  // If we're sitting on whitespace (e.g. between words), fall back to the
  // previous non-whitespace character so the highlight doesn't disappear.
  if (/\s/.test(ref[pos])) {
    for (let p = Math.min(pos - 1, ref.length - 1); p >= 0; p -= 1) {
      if (!/\s/.test(ref[p])) {
        pos = p;
        break;
      }
    }
  }

  for (let i = 0; i < srcTokenRanges.length; i += 1) {
    const r = srcTokenRanges[i];
    if (r.start <= pos && pos < r.end) return i;
  }
  return null;
}

function updateEnglishHighlight() {
  if (!currentItem) return;
  for (const s of tgtTokenSpans) s.classList.remove('hl');

  const srcIdx = getActiveSrcTokenIndex();
  if (srcIdx === null) return;

  const alignMap = currentItem.align || {};
  const aligned = alignMap[String(srcIdx)] || [];

  // If alignment isn't available yet (often because the SimAlign model is
  // still loading on first run), fall back to a cheap proportional mapping so
  // the underline feature works immediately.
  if (!aligned.length) {
    const srcCount = Math.max(1, srcTokenRanges.length);
    const tgtCount = Math.max(1, tgtTokenSpans.length);
    const denom = Math.max(1, srcCount - 1);
    const j = Math.round((srcIdx * (tgtCount - 1)) / denom);
    if (j >= 0 && j < tgtTokenSpans.length) tgtTokenSpans[j].classList.add('hl');
    return;
  }

  for (const j of aligned) {
    if (j >= 0 && j < tgtTokenSpans.length) {
      tgtTokenSpans[j].classList.add('hl');
    }
  }
}

function startSentence(item) {
  currentItem = item;
  typedBuffer = [];
  cursorIndex = 0;
  inputEnabled = true;

  buildSpansForReference(item.spanish);
  srcTokenRanges = computeTokenRanges(item.spanish);
  boundarySpaceSpans = computeBoundaryWhitespaceSpans(item.spanish);
  renderEnglishTokens(item.tgt_tokens || item.english.split(/\s+/).filter(Boolean));

  setMeta('');
  // Alignment is fetched lazily so the first paint is fast.
  if (item.sp_id) {
    fetchAlignment(item.sp_id);
  }

  el.retryBtn.disabled = false;
  el.typingBox.focus();
  updateRenderFromBuffer();
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

  const ref = currentItem.spanish;
  if (cursorIndex >= ref.length) return;

  startAttemptIfNeeded();

  const expected = ref[cursorIndex];
  roundTyped += 1;
  if (ch === expected) roundCorrect += 1;
  if (!/\s/.test(ch)) roundNonSpace += 1;

  typedBuffer[cursorIndex] = ch;
  cursorIndex = Math.min(ref.length, cursorIndex + 1);
  updateRenderFromBuffer();

  if (cursorIndex >= ref.length) {
    sentencesCompleted += 1;
    if (timerRunning) {
      loadRandomSentence().catch((e) => {
        setMeta(String(e?.message || e));
      });
    }
  }
}

function handleBackspace() {
  if (!currentItem) return;
  if (!inputEnabled) return;
  if (cursorIndex <= 0) return;

  cursorIndex -= 1;
  typedBuffer.splice(cursorIndex, 1);
  updateRenderFromBuffer();
}

el.typingBox.addEventListener('click', () => {
  el.typingBox.focus();
});

el.typingBox.addEventListener('keydown', (ev) => {
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
    // Most sentences are single-line; ignore Enter.
    ev.preventDefault();
    return;
  }

  if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
    ev.preventDefault();
    acceptChar(ev.key);
  }
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
