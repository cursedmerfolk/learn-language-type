let currentChunk = null;
let timerRunning = false;
let startTs = null;
let timerInterval = null;
let durationSeconds = 30;

function durationMs() {
  return durationSeconds * 1000;
}

const HIGH_SCORE_KEY = 'code_typing_high_score_v1';
const DURATION_KEY = 'code_typing_duration_seconds_v1';

let inputEnabled = true;
let typedBuffer = [];
let cursorIndex = 0;
let charSpans = [];
let cursorEndEl = null;

const el = {
  chunkMeta: document.getElementById('chunkMeta'),
  typingBox: document.getElementById('typingBox'),
  timeLeft: document.getElementById('timeLeft'),
  status: document.getElementById('status'),
  highScore: document.getElementById('highScore'),
  newChunkBtn: document.getElementById('newChunkBtn'),
  retryBtn: document.getElementById('retryBtn'),
  resultsDialog: document.getElementById('resultsDialog'),
  cpmValue: document.getElementById('cpmValue'),
  accuracyValue: document.getElementById('accuracyValue'),
  scoreValue: document.getElementById('scoreValue'),
  dialogRetry: document.getElementById('dialogRetry'),
  dialogNew: document.getElementById('dialogNew'),
};

function getHighScore() {
  const raw = localStorage.getItem(HIGH_SCORE_KEY);
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function setHighScore(value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v < 0) return;
  localStorage.setItem(HIGH_SCORE_KEY, String(v));
}

function renderHighScore() {
  const hs = getHighScore();
  el.highScore.textContent = hs <= 0 ? '—' : hs.toFixed(1);
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

function hardResetTyping() {
  stopTimer();
  typedBuffer = [];
  cursorIndex = 0;
  resetTimerUi();
  setStatus('Waiting');
  inputEnabled = true;
  updateRenderFromBuffer();
}

function computeResults(referenceText, typedText) {
  const nonSpaceCount = typedText.replace(/\s/g, '').length;
  const elapsedMinutes = durationMs() / 60_000;
  const cpm = Math.round(nonSpaceCount / elapsedMinutes);

  const compareLen = Math.min(referenceText.length, typedText.length);
  let correct = 0;
  for (let i = 0; i < compareLen; i += 1) {
    if (referenceText[i] === typedText[i]) correct += 1;
  }
  // If user typed beyond reference, treat extras as incorrect.
  const incorrect = (typedText.length - correct);
  const accuracy = typedText.length === 0 ? 0 : (correct / typedText.length) * 100;

  return {
    cpm,
    accuracy,
    correct,
    incorrect,
    typed: typedText.length,
  };
}

function showResults() {
  const typed = typedBuffer.join('');
  const ref = currentChunk?.text ?? '';
  const r = computeResults(ref, typed);

  const score = r.cpm * (r.accuracy / 100);
  const roundedScore = Number.isFinite(score) ? score : 0;

  el.cpmValue.textContent = String(r.cpm);
  el.accuracyValue.textContent = `${r.accuracy.toFixed(1)}%`;
  el.scoreValue.textContent = roundedScore.toFixed(1);

  const hs = getHighScore();
  if (roundedScore > hs) {
    setHighScore(roundedScore);
  }
  renderHighScore();

  el.resultsDialog.showModal();
}

function tick() {
  if (!timerRunning || !startTs) return;
  const now = performance.now();
  const elapsed = now - startTs;
  const remaining = Math.max(0, durationMs() - elapsed);
  el.timeLeft.textContent = (remaining / 1000).toFixed(1);

  if (remaining <= 0) {
    stopTimer();
    setStatus('Done');
    inputEnabled = false;
    showResults();
  }
}

function startTimerIfNeeded() {
  if (timerRunning) return;
  timerRunning = true;
  startTs = performance.now();
  setStatus('Running');
  timerInterval = setInterval(tick, 50);
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

  // Simplest behavior: changing duration resets the current attempt.
  hardResetTyping();
  skipIndentationIfAtLineStart();
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
    const ch = referenceText[i];
    const span = document.createElement('span');
    span.className = 'ch';
    span.textContent = ch;
    charSpans.push(span);
    el.typingBox.appendChild(span);
  }

  cursorEndEl = document.createElement('span');
  cursorEndEl.className = 'cursorEnd';
  el.typingBox.appendChild(cursorEndEl);
}

function updateCursorVisual() {
  for (const s of charSpans) s.classList.remove('cursor');
  if (!currentChunk) return;

  if (cursorIndex >= charSpans.length) {
    cursorEndEl.style.display = 'inline-block';
    return;
  }

  cursorEndEl.style.display = 'none';
  charSpans[cursorIndex].classList.add('cursor');
}

function updateRenderFromBuffer() {
  if (!currentChunk) return;

  const referenceText = currentChunk.text;
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
}

function scrollCursorIntoView() {
  const cursorEl = el.typingBox.querySelector('.ch.cursor');
  const target = cursorEl || cursorEndEl;
  if (!target) return;
  // Keep scrolling minimal.
  try {
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  } catch {
    // Older browsers / no options support.
    target.scrollIntoView();
  }
}

function skipIndentationIfAtLineStart({ scroll = false } = {}) {
  if (!currentChunk) return;
  if (!inputEnabled) return;

  const ref = currentChunk.text;
  const atLineStart = cursorIndex === 0 || ref[cursorIndex - 1] === '\n';
  if (!atLineStart) return;

  // Auto-fill leading indentation so the cursor starts at first non-space.
  while (cursorIndex < ref.length && (ref[cursorIndex] === ' ' || ref[cursorIndex] === '\t')) {
    typedBuffer.push(ref[cursorIndex]);
    cursorIndex += 1;
  }

  updateRenderFromBuffer();
  if (scroll) scrollCursorIntoView();
}

function acceptChar(ch) {
  if (!currentChunk) return;
  if (!inputEnabled) return;

  const referenceText = currentChunk.text;
  if (cursorIndex >= referenceText.length) return;

  typedBuffer[cursorIndex] = ch;
  cursorIndex = Math.min(referenceText.length, cursorIndex + 1);
  updateRenderFromBuffer();
}

function handleBackspace() {
  if (!currentChunk) return;
  if (!inputEnabled) return;
  if (cursorIndex <= 0) return;

  cursorIndex -= 1;
  typedBuffer.splice(cursorIndex, 1);
  updateRenderFromBuffer();
}

function setChunk(chunk) {
  currentChunk = chunk;
  buildSpansForReference(chunk.text);
  el.chunkMeta.textContent = `${chunk.filename}  (lines ${chunk.start_line}-${chunk.end_line})  •  id ${chunk.id}`;
  el.retryBtn.disabled = false;

  // Encode current chunk in the URL for sharing/reloading.
  if (chunk.page && chunk.start_line) {
    const url = new URL(window.location.href);
    url.searchParams.set('page', chunk.page);
    url.searchParams.set('line', String(chunk.start_line));
    history.replaceState(null, '', url);
  }

  hardResetTyping();
  skipIndentationIfAtLineStart();
  el.typingBox.focus();
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

async function loadRandomChunk() {
  setStatus('Loading');
  try {
    const chunk = await fetchJson('/api/chunk/random');
    setChunk(chunk);
  } catch (e) {
    el.chunkMeta.textContent = String(e?.message || e);
    el.typingBox.textContent = '';
    setStatus('Error');
    el.retryBtn.disabled = true;
    inputEnabled = false;
  }
}

async function loadChunkById(id) {
  setStatus('Loading');
  try {
    const chunk = await fetchJson(`/api/chunk?id=${encodeURIComponent(id)}`);
    setChunk(chunk);
  } catch (e) {
    el.chunkMeta.textContent = String(e?.message || e);
    el.typingBox.textContent = '';
    setStatus('Error');
    el.retryBtn.disabled = true;
    inputEnabled = false;
  }
}

async function loadChunkByLocation(page, line) {
  setStatus('Loading');
  try {
    const chunk = await fetchJson(`/api/chunk/loc?page=${encodeURIComponent(page)}&line=${encodeURIComponent(String(line))}`);
    setChunk(chunk);
  } catch (e) {
    el.chunkMeta.textContent = String(e?.message || e);
    el.typingBox.textContent = '';
    setStatus('Error');
    el.retryBtn.disabled = true;
    inputEnabled = false;
  }
}

function getInitialLocationFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const page = (params.get('page') || '').trim();
  const lineRaw = (params.get('line') || '').trim();
  if (!page) return null;

  const line = Number(lineRaw);
  if (!Number.isFinite(line) || line <= 0) {
    return { page, line: 1 };
  }
  return { page, line: Math.floor(line) };
}

el.typingBox.addEventListener('click', () => {
  el.typingBox.focus();
});

el.typingBox.addEventListener('keydown', (ev) => {
  if (!currentChunk) return;
  if (!inputEnabled) {
    ev.preventDefault();
    return;
  }

  // If we're at the beginning of a line, keep the cursor on the first non-space.
  // This handles initial focus and post-backspace cases.
  skipIndentationIfAtLineStart();

  // Prevent the browser from scrolling on space.
  if (ev.key === ' ') {
    ev.preventDefault();
    startTimerIfNeeded();
    acceptChar(' ');
    return;
  }

  if (ev.key === 'Backspace') {
    ev.preventDefault();
    handleBackspace();
    return;
  }

  if (ev.key === 'Tab') {
    ev.preventDefault();
    startTimerIfNeeded();
    acceptChar('\t');
    return;
  }

  if (ev.key === 'Enter') {
    ev.preventDefault();
    startTimerIfNeeded();
    const ref = currentChunk.text;
    const isAtActualNewline = cursorIndex < ref.length && ref[cursorIndex] === '\n';
    acceptChar('\n');
    // If Enter matched the end-of-line newline, jump to next line's first non-space and scroll.
    if (isAtActualNewline) {
      skipIndentationIfAtLineStart({ scroll: true });
    }
    return;
  }

  // Printable characters
  if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
    ev.preventDefault();
    startTimerIfNeeded();
    acceptChar(ev.key);
    return;
  }
});

el.newChunkBtn.addEventListener('click', async () => {
  await loadRandomChunk();
});

el.retryBtn.addEventListener('click', async () => {
  if (!currentChunk) return;
  if (currentChunk.page && currentChunk.start_line) {
    await loadChunkByLocation(currentChunk.page, currentChunk.start_line);
    return;
  }
  if (currentChunk.id) await loadChunkById(currentChunk.id);
});

el.resultsDialog.addEventListener('close', async () => {
  const action = el.resultsDialog.returnValue;
  if (action === 'retry') {
    if (currentChunk?.page && currentChunk?.start_line) {
      await loadChunkByLocation(currentChunk.page, currentChunk.start_line);
    } else if (currentChunk?.id) {
      await loadChunkById(currentChunk.id);
    }
  } else if (action === 'new') {
    await loadRandomChunk();
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

  renderHighScore();

  const loc = getInitialLocationFromUrl();
  if (loc) {
    await loadChunkByLocation(loc.page, loc.line);
  } else {
    await loadRandomChunk();
  }
});
