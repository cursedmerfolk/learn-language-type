let currentChunk = null;
let timerRunning = false;
let startTs = null;
let timerInterval = null;
const DURATION_MS = 30_000;

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
  newChunkBtn: document.getElementById('newChunkBtn'),
  retryBtn: document.getElementById('retryBtn'),
  resultsDialog: document.getElementById('resultsDialog'),
  cpmValue: document.getElementById('cpmValue'),
  accuracyValue: document.getElementById('accuracyValue'),
  dialogRetry: document.getElementById('dialogRetry'),
  dialogNew: document.getElementById('dialogNew'),
};

function setStatus(text) {
  el.status.textContent = text;
}

function resetTimerUi() {
  el.timeLeft.textContent = '30.0';
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
  const n = typedText.length;
  const elapsedMinutes = DURATION_MS / 60_000;
  const cpm = Math.round(n / elapsedMinutes);

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

  el.cpmValue.textContent = String(r.cpm);
  el.accuracyValue.textContent = `${r.accuracy.toFixed(1)}%`;

  el.resultsDialog.showModal();
}

function tick() {
  if (!timerRunning || !startTs) return;
  const now = performance.now();
  const elapsed = now - startTs;
  const remaining = Math.max(0, DURATION_MS - elapsed);
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

  hardResetTyping();
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

el.typingBox.addEventListener('click', () => {
  el.typingBox.focus();
});

el.typingBox.addEventListener('keydown', (ev) => {
  if (!currentChunk) return;
  if (!inputEnabled) {
    ev.preventDefault();
    return;
  }

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
    acceptChar('\n');
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
  if (!currentChunk?.id) return;
  await loadChunkById(currentChunk.id);
});

el.resultsDialog.addEventListener('close', async () => {
  const action = el.resultsDialog.returnValue;
  if (action === 'retry') {
    if (currentChunk?.id) await loadChunkById(currentChunk.id);
  } else if (action === 'new') {
    await loadRandomChunk();
  }
});

window.addEventListener('load', async () => {
  await loadRandomChunk();
});
