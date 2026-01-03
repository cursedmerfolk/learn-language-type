let currentChunk = null;
let timerRunning = false;
let startTs = null;
let timerInterval = null;
const DURATION_MS = 30_000;

const el = {
  chunkMeta: document.getElementById('chunkMeta'),
  codeBlock: document.getElementById('codeBlock'),
  typingInput: document.getElementById('typingInput'),
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
  el.typingInput.value = '';
  resetTimerUi();
  setStatus('Waiting');
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
  const typed = el.typingInput.value;
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
    el.typingInput.disabled = true;
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

function setChunk(chunk) {
  currentChunk = chunk;
  el.codeBlock.textContent = chunk.text;
  el.chunkMeta.textContent = `${chunk.filename}  (lines ${chunk.start_line}-${chunk.end_line})  •  id ${chunk.id}`;
  el.retryBtn.disabled = false;

  el.typingInput.disabled = false;
  hardResetTyping();
  el.typingInput.focus();
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
    el.codeBlock.textContent = '';
    setStatus('Error');
    el.retryBtn.disabled = true;
    el.typingInput.disabled = true;
  }
}

async function loadChunkById(id) {
  setStatus('Loading');
  try {
    const chunk = await fetchJson(`/api/chunk?id=${encodeURIComponent(id)}`);
    setChunk(chunk);
  } catch (e) {
    el.chunkMeta.textContent = String(e?.message || e);
    el.codeBlock.textContent = '';
    setStatus('Error');
    el.retryBtn.disabled = true;
    el.typingInput.disabled = true;
  }
}

el.typingInput.addEventListener('keydown', (ev) => {
  // Start timer on first actual typing key.
  if (ev.key.length === 1 || ev.key === 'Enter' || ev.key === 'Tab' || ev.key === 'Backspace' || ev.key === 'Delete') {
    startTimerIfNeeded();
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
