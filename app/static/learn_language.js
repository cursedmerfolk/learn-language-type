let queue = [];
let queueIndex = 0;

let currentItem = null;
let inputEnabled = true;
let typedBuffer = [];
let cursorIndex = 0;
let charSpans = [];
let cursorEndEl = null;
let srcTokenRanges = [];
let tgtTokenSpans = [];

const el = {
  sentenceMeta: document.getElementById('sentenceMeta'),
  englishBox: document.getElementById('englishBox'),
  typingBox: document.getElementById('typingBox'),
  newSetBtn: document.getElementById('newSetBtn'),
  retryBtn: document.getElementById('retryBtn'),
};

function setMeta(text) {
  el.sentenceMeta.textContent = text;
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

  const idx = queueIndex + 1;
  const total = queue.length;
  setMeta(`Sentence ${idx}/${total}`);
  if (item.align_error) {
    setMeta(`Sentence ${idx}/${total} • Alignment unavailable (${item.align_error})`);
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

async function loadNewQueue() {
  setMeta('Loading…');
  const data = await fetchJson('/api/learn/random?count=10');
  queue = data.items || [];
  queueIndex = 0;
  if (!queue.length) throw new Error('No sentence pairs available');
  startSentence(queue[0]);
}

async function loadQueueByIds(ids) {
  setMeta('Loading…');
  const data = await fetchJson(`/api/learn/by_ids?ids=${encodeURIComponent(ids.join(','))}`);
  queue = data.items || [];
  queueIndex = 0;
  if (!queue.length) throw new Error('No sentence pairs available for ids');
  startSentence(queue[0]);
}

function acceptChar(ch) {
  if (!currentItem) return;
  if (!inputEnabled) return;

  const ref = currentItem.spanish;
  if (cursorIndex >= ref.length) return;

  typedBuffer[cursorIndex] = ch;
  cursorIndex = Math.min(ref.length, cursorIndex + 1);
  updateRenderFromBuffer();

  if (cursorIndex >= ref.length) {
    // Advance to next sentence in the queue.
    queueIndex += 1;
    if (queueIndex < queue.length) {
      startSentence(queue[queueIndex]);
    } else {
      loadNewQueue().catch((e) => {
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

el.newSetBtn.addEventListener('click', async () => {
  await loadNewQueue().catch((e) => setMeta(String(e?.message || e)));
});

el.retryBtn.addEventListener('click', () => {
  if (!currentItem) return;
  startSentence(currentItem);
});

window.addEventListener('load', async () => {
  const params = new URLSearchParams(window.location.search);
  const idsRaw = (params.get('ids') || '').trim();
  if (idsRaw) {
    const ids = idsRaw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length) {
      await loadQueueByIds(ids);
      return;
    }
  }

  await loadNewQueue().catch((e) => {
    setMeta(String(e?.message || e));
    el.retryBtn.disabled = true;
    inputEnabled = false;
  });
});
