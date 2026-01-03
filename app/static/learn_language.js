let currentItem = null;
let inputEnabled = true;
let typedBuffer = [];
let cursorIndex = 0;
let charSpans = [];
let cursorEndEl = null;
let srcTokenRanges = [];
let tgtTokenSpans = [];

let durationSeconds = 30;
let timerRunning = false;
let startTs = null;
let timerInterval = null;

let roundCorrect = 0;
let roundTyped = 0;
let roundNonSpace = 0;
let sentencesCompleted = 0;

const el = {
  sentenceMeta: document.getElementById('sentenceMeta'),
  englishBox: document.getElementById('englishBox'),
  typingBox: document.getElementById('typingBox'),
  timeLeft: document.getElementById('timeLeft'),
  status: document.getElementById('status'),
  durationPane: document.getElementById('durationPane'),
  newRoundBtn: document.getElementById('newRoundBtn'),
  retryBtn: document.getElementById('retryBtn'),
  resultsDialog: document.getElementById('resultsDialog'),
  cpmValue: document.getElementById('cpmValue'),
  accuracyValue: document.getElementById('accuracyValue'),
  sentencesValue: document.getElementById('sentencesValue'),
  dialogNew: document.getElementById('dialogNew'),
};

const DURATION_KEY = 'code_typing_duration_seconds_v1';

function setMeta(text) {
  el.sentenceMeta.textContent = text;
}

function setStatus(text) {
  el.status.textContent = text;
}

function resetTimerUi() {
  el.timeLeft.textContent = `${durationSeconds.toFixed(1)}`;
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

  if (remaining <= 0) {
    stopTimer();
    inputEnabled = false;
    setStatus('Done');
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
  const accuracy = roundTyped === 0 ? 0 : (roundCorrect / roundTyped) * 100;
  return { cpm, accuracy };
}

function showResults(elapsedMs) {
  const r = computeResults(elapsedMs);
  el.cpmValue.textContent = String(r.cpm);
  el.accuracyValue.textContent = `${r.accuracy.toFixed(1)}%`;
  el.sentencesValue.textContent = String(sentencesCompleted);
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

  for (let i = 0; i < tokens.length; i += 1) {
    if (i > 0) el.englishBox.appendChild(document.createTextNode(' '));
    const span = document.createElement('span');
    span.className = 'tok';
    span.textContent = tokens[i];
    tgtTokenSpans.push(span);
    el.englishBox.appendChild(span);
  }
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

function findLastNonWhitespacePos() {
  if (!currentItem) return null;
  const ref = currentItem.spanish;
  for (let pos = Math.min(cursorIndex - 1, ref.length - 1); pos >= 0; pos -= 1) {
    if (pos < typedBuffer.length && typedBuffer[pos] !== undefined && !/\s/.test(ref[pos])) {
      return pos;
    }
  }
  return null;
}

function getActiveSrcTokenIndex() {
  const pos = findLastNonWhitespacePos();
  if (pos === null) return null;
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

  const aligned = (currentItem.align || {})[String(srcIdx)] || [];
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
  durationSeconds = getSavedDurationSeconds();
  syncDurationUi();

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
