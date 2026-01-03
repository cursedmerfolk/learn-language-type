let currentChunk = null;
let timerRunning = false;
let startTs = null;
let timerInterval = null;
let durationSeconds = 30;

let shaderMode = false;
let shaderName = null;
let shaderExample = null;
let shaderDirty = false;
let shaderCompileTimer = null;
let gl = null;
let glProgram = null;
let glFullScreenBuf = null;
let glTexture = null;
let glStartTs = performance.now();
let glFrame = 0;
let lastMouse = { x: 0, y: 0 };

let shaderUiReady = false;

let attemptStartTs = null;

function durationMs() {
  return durationSeconds * 1000;
}

const HIGH_SCORE_KEY_V1 = 'code_typing_high_score_v1';
const HIGH_SCORE_KEY = 'code_typing_high_score_wpm_v1';
const DURATION_KEY = 'code_typing_duration_seconds_v1';

function toWpmFromCpm(cpm) {
  const n = Number(cpm);
  if (!Number.isFinite(n)) return 0;
  return n / 5;
}

let inputEnabled = true;
let typedBuffer = [];
let cursorIndex = 0;
let charSpans = [];
let cursorEndEl = null;

const el = {
  chunkMeta: document.getElementById('chunkMeta'),
  shaderPreviewPane: document.getElementById('shaderPreviewPane'),
  shaderCanvas: document.getElementById('shaderCanvas'),
  typingBox: document.getElementById('typingBox'),
  timeLeft: document.getElementById('timeLeft'),
  status: document.getElementById('status'),
  highScore: document.getElementById('highScore'),
  durationPane: document.getElementById('durationPane'),
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
  if (Number.isFinite(n) && n >= 0) return n;

  // Migrate from legacy CPM-based score if present.
  const legacyRaw = localStorage.getItem(HIGH_SCORE_KEY_V1);
  const legacy = Number(legacyRaw);
  if (!Number.isFinite(legacy) || legacy <= 0) return 0;
  const migrated = toWpmFromCpm(legacy);
  localStorage.setItem(HIGH_SCORE_KEY, String(migrated));
  return migrated;
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

function setShaderPreviewVisible(visible) {
  if (!el.shaderPreviewPane) return;
  el.shaderPreviewPane.classList.toggle('hidden', !visible);
}

function setDurationVisible(visible) {
  if (!el.durationPane) return;
  el.durationPane.classList.toggle('hidden', !visible);
}

function resetTimerUi() {
  if (shaderMode) {
    el.timeLeft.textContent = '—';
  } else {
    el.timeLeft.textContent = `${durationSeconds.toFixed(1)}`;
  }
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
  attemptStartTs = null;
  resetTimerUi();
  setStatus('Waiting');
  inputEnabled = true;
  updateRenderFromBuffer();
}

function computeResults(referenceText, typedText, elapsedMs) {
  const nonSpaceCount = typedText.replace(/\s/g, '').length;
  const safeElapsedMs = Math.max(1, elapsedMs);
  const elapsedMinutes = safeElapsedMs / 60_000;
  const cpm = Math.round(nonSpaceCount / elapsedMinutes);
  const wpm = cpm / 5;

  const compareLen = Math.min(referenceText.length, typedText.length);
  let correct = 0;
  for (let i = 0; i < compareLen; i += 1) {
    if (referenceText[i] === typedText[i]) correct += 1;
  }
  // If user typed beyond reference, treat extras as incorrect.
  const incorrect = (typedText.length - correct);
  const accuracy = typedText.length === 0 ? 0 : (correct / typedText.length) * 100;

  return {
    wpm,
    accuracy,
    correct,
    incorrect,
    typed: typedText.length,
  };
}

function showResults(elapsedMs) {
  const typed = typedBuffer.join('');
  const ref = currentChunk?.text ?? '';
  const r = computeResults(ref, typed, elapsedMs);

  const score = r.wpm * (r.accuracy / 100);
  const roundedScore = Number.isFinite(score) ? score : 0;

  el.cpmValue.textContent = r.wpm.toFixed(1);
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
    showResults(durationMs());
  }
}

function startAttemptIfNeeded() {
  if (shaderMode) {
    if (attemptStartTs) return;
    attemptStartTs = performance.now();
    setStatus('Running');
    return;
  }

  if (timerRunning) return;
  timerRunning = true;
  startTs = performance.now();
  setStatus('Running');
  timerInterval = setInterval(tick, 50);
}

function finishShaderAttemptIfComplete() {
  if (!shaderMode) return;
  if (!currentChunk) return;
  if (!inputEnabled) return;

  if (cursorIndex < currentChunk.text.length) return;

  inputEnabled = false;
  setStatus('Done');
  const elapsedMs = attemptStartTs ? (performance.now() - attemptStartTs) : 1;
  showResults(elapsedMs);
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

function getInitialShaderFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const s = (params.get('shader') || '').trim();
  return s || null;
}

function getInitialExampleFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const s = (params.get('example') || '').trim();
  return s || null;
}

function updateUrlForExample(name) {
  const url = new URL(window.location.href);
  url.searchParams.set('example', name);
  url.searchParams.delete('shader');
  url.searchParams.delete('page');
  url.searchParams.delete('line');
  history.replaceState(null, '', url);
}

function updateUrlForShader(name) {
  const url = new URL(window.location.href);
  url.searchParams.set('shader', name);
  url.searchParams.delete('example');
  url.searchParams.delete('page');
  url.searchParams.delete('line');
  history.replaceState(null, '', url);
}

function updateUrlForCode(page, line) {
  const url = new URL(window.location.href);
  url.searchParams.set('page', page);
  url.searchParams.set('line', String(line));
  url.searchParams.delete('shader');
  history.replaceState(null, '', url);
}

function getShaderVertexSource() {
  return `attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;
}

function getFallbackFragmentSource() {
  return `precision mediump float;
void main() {
  gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
}`;
}

function compileShader(glCtx, type, src) {
  const sh = glCtx.createShader(type);
  glCtx.shaderSource(sh, src);
  glCtx.compileShader(sh);
  if (!glCtx.getShaderParameter(sh, glCtx.COMPILE_STATUS)) {
    const msg = glCtx.getShaderInfoLog(sh) || 'Shader compile failed';
    glCtx.deleteShader(sh);
    throw new Error(msg);
  }
  return sh;
}

function linkProgram(glCtx, vsSrc, fsSrc) {
  const vs = compileShader(glCtx, glCtx.VERTEX_SHADER, vsSrc);
  const fs = compileShader(glCtx, glCtx.FRAGMENT_SHADER, fsSrc);

  const prog = glCtx.createProgram();
  glCtx.attachShader(prog, vs);
  glCtx.attachShader(prog, fs);
  glCtx.linkProgram(prog);

  glCtx.deleteShader(vs);
  glCtx.deleteShader(fs);

  if (!glCtx.getProgramParameter(prog, glCtx.LINK_STATUS)) {
    const msg = glCtx.getProgramInfoLog(prog) || 'Program link failed';
    glCtx.deleteProgram(prog);
    throw new Error(msg);
  }

  return prog;
}

function ensureWebGL() {
  if (gl) return gl;
  if (!el.shaderCanvas) return null;

  const ctx = el.shaderCanvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: false });
  if (!ctx) return null;

  gl = ctx;

  // Fullscreen triangle, interleaved: position.xyz, uv.xy
  // This supports WebContent shaders that expect attributes `position` and `uv`.
  glFullScreenBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, glFullScreenBuf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      // x,  y,  z,   u, v
      -1, -1, 0,   0, 0,
      3, -1, 0,    2, 0,
      -1, 3, 0,    0, 2,
    ]),
    gl.STATIC_DRAW,
  );

  // A simple fallback texture for shaders that sample `u_texture`.
  glTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, glTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const texW = 256;
  const texH = 256;
  const pixels = new Uint8Array(texW * texH * 4);
  for (let y = 0; y < texH; y += 1) {
    for (let x = 0; x < texW; x += 1) {
      const i = (y * texW + x) * 4;
      pixels[i + 0] = Math.floor((x / (texW - 1)) * 255);
      pixels[i + 1] = Math.floor((y / (texH - 1)) * 255);
      pixels[i + 2] = 160;
      pixels[i + 3] = 255;
    }
  }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texW, texH, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  return gl;
}

function setupShaderUiIfNeeded() {
  if (shaderUiReady) return;
  shaderUiReady = true;
  // Capture mouse for u_mouse
  el.shaderCanvas?.addEventListener('mousemove', (ev) => {
    const rect = el.shaderCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    lastMouse = {
      x: (ev.clientX - rect.left) * dpr,
      y: (rect.height - (ev.clientY - rect.top)) * dpr,
    };
  });
  window.addEventListener('resize', () => resizeCanvasToCss());
  resizeCanvasToCss();
}

function resizeCanvasToCss() {
  if (!el.shaderCanvas) return;
  const rect = el.shaderCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (el.shaderCanvas.width !== w || el.shaderCanvas.height !== h) {
    el.shaderCanvas.width = w;
    el.shaderCanvas.height = h;
  }
}

function scheduleShaderCompile() {
  shaderDirty = true;
  if (shaderCompileTimer) clearTimeout(shaderCompileTimer);
  shaderCompileTimer = setTimeout(() => {
    tryCompileAndUseShader();
  }, 800);
}

function buildOverlaySource(referenceText) {
  // Build a full-length shader source by overlaying typed characters over the
  // reference. This keeps the shader mostly valid while the user types, and
  // ensures compiler errors disappear when the user fixes mistakes.
  const out = new Array(referenceText.length);
  for (let i = 0; i < referenceText.length; i += 1) {
    const typed = i < typedBuffer.length ? typedBuffer[i] : undefined;
    out[i] = (typed === undefined ? referenceText[i] : typed);
  }
  return out.join('');
}

function injectExampleVertexPrelude(vsSrc) {
  // Many WebContent examples rely on three.js providing built-in attributes like
  // `position` and `uv`. In plain WebGL, shaders must declare these explicitly.
  const src = String(vsSrc || '');
  const hasAttrPosition = /\battribute\s+\w+\s+position\b/.test(src);
  const hasAttrUv = /\battribute\s+\w+\s+uv\b/.test(src);
  const needsPosition = /\bposition\b/.test(src) && !hasAttrPosition;
  const needsUv = /\buv\b/.test(src) && !hasAttrUv;

  if (!needsPosition && !needsUv) return src;

  const prelude = [
    needsPosition ? 'attribute vec3 position;' : null,
    needsUv ? 'attribute vec2 uv;' : null,
  ].filter(Boolean).join('\n');

  return `${prelude}\n${src}`;
}

function tryCompileAndUseShader() {
  if (!shaderMode) return;
  if (!shaderDirty) return;
  shaderDirty = false;

  const glCtx = ensureWebGL();
  if (!glCtx) {
    el.chunkMeta.textContent = 'WebGL not available in this browser.';
    return;
  }

  const referenceText = currentChunk?.text ?? '';
  const typedOverlay = buildOverlaySource(referenceText);

  // Legacy shader mode: `shaderName` is a .glsl file name; example mode uses `currentChunk.vertex`.
  let vsSrc = currentChunk?.vertex ?? getShaderVertexSource();
  let fsSrc = typedOverlay;

  // If the user is typing a vertex shader (legacy), use a fallback fragment.
  if (shaderName && shaderName.startsWith('vert-')) {
    vsSrc = typedOverlay;
    fsSrc = getFallbackFragmentSource();
  }

  // Example mode: inject predeclared attributes that three.js would normally add.
  if (currentChunk?.example && currentChunk?.vertex) {
    vsSrc = injectExampleVertexPrelude(vsSrc);
  }

  try {
    const prog = linkProgram(glCtx, vsSrc, fsSrc);
    if (glProgram) glCtx.deleteProgram(glProgram);
    glProgram = prog;
    // Keep metadata concise; only show errors when present.
    if (shaderExample) {
      el.chunkMeta.textContent = `Example: ${shaderExample}`;
    } else if (shaderName) {
      el.chunkMeta.textContent = `Shader: ${shaderName}`;
    }
  } catch (e) {
    // Show compiler error; keep last good program if any.
    const msg = String(e?.message || e);
    const label = shaderExample ? `Example: ${shaderExample}` : `Shader: ${shaderName || 'unknown'}`;
    el.chunkMeta.textContent = `${label}  •  Compile error: ${msg}`;
  }
}

function renderShaderFrame() {
  if (!shaderMode) return;
  const glCtx = ensureWebGL();
  if (!glCtx) return;

  resizeCanvasToCss();
  glCtx.viewport(0, 0, el.shaderCanvas.width, el.shaderCanvas.height);
  glCtx.clearColor(0, 0, 0, 1);
  glCtx.clear(glCtx.COLOR_BUFFER_BIT);

  if (!glProgram) {
    requestAnimationFrame(renderShaderFrame);
    return;
  }

  glCtx.useProgram(glProgram);

  if (glFullScreenBuf) {
    glCtx.bindBuffer(glCtx.ARRAY_BUFFER, glFullScreenBuf);
  }

  // Attribute
  const aPos = glCtx.getAttribLocation(glProgram, 'a_pos');
  if (aPos >= 0) {
    glCtx.enableVertexAttribArray(aPos);
    // Uses x/y from position.xyz (stride 5 floats).
    glCtx.vertexAttribPointer(aPos, 2, glCtx.FLOAT, false, 20, 0);
  }

  const aPosition = glCtx.getAttribLocation(glProgram, 'position');
  if (aPosition >= 0) {
    glCtx.enableVertexAttribArray(aPosition);
    glCtx.vertexAttribPointer(aPosition, 3, glCtx.FLOAT, false, 20, 0);
  }

  const aUv = glCtx.getAttribLocation(glProgram, 'uv');
  if (aUv >= 0) {
    glCtx.enableVertexAttribArray(aUv);
    glCtx.vertexAttribPointer(aUv, 2, glCtx.FLOAT, false, 20, 12);
  }

  // Uniforms used by this repo
  const uRes = glCtx.getUniformLocation(glProgram, 'u_resolution');
  if (uRes) glCtx.uniform2f(uRes, el.shaderCanvas.width, el.shaderCanvas.height);
  const uMouse = glCtx.getUniformLocation(glProgram, 'u_mouse');
  if (uMouse) glCtx.uniform2f(uMouse, lastMouse.x, lastMouse.y);
  const uTime = glCtx.getUniformLocation(glProgram, 'u_time');
  if (uTime) glCtx.uniform1f(uTime, (performance.now() - glStartTs) / 1000.0);
  const uFrame = glCtx.getUniformLocation(glProgram, 'u_frame');
  if (uFrame) glCtx.uniform1f(uFrame, glFrame);

  const uTex = glCtx.getUniformLocation(glProgram, 'u_texture');
  if (uTex && glTexture) {
    glCtx.activeTexture(glCtx.TEXTURE0);
    glCtx.bindTexture(glCtx.TEXTURE_2D, glTexture);
    glCtx.uniform1i(uTex, 0);
  }

  glCtx.drawArrays(glCtx.TRIANGLES, 0, 3);
  glFrame += 1;

  requestAnimationFrame(renderShaderFrame);
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
  if (shaderMode) scheduleShaderCompile();
  finishShaderAttemptIfComplete();
}

function handleBackspace() {
  if (!currentChunk) return;
  if (!inputEnabled) return;
  if (cursorIndex <= 0) return;

  cursorIndex -= 1;
  typedBuffer.splice(cursorIndex, 1);
  updateRenderFromBuffer();
  if (shaderMode) scheduleShaderCompile();
}

function setChunk(chunk) {
  currentChunk = chunk;
  buildSpansForReference(chunk.text);
  if (chunk.shader || chunk.example) {
    shaderMode = true;
    shaderName = chunk.shader || null;
    shaderExample = chunk.example || null;
    setShaderPreviewVisible(true);
    setDurationVisible(false);
    setupShaderUiIfNeeded();
    if (chunk.example) {
      el.chunkMeta.textContent = `Example: ${chunk.example}`;
      updateUrlForExample(chunk.example);
    } else {
      el.chunkMeta.textContent = `Shader: ${chunk.shader}`;
      updateUrlForShader(chunk.shader);
    }
    el.newChunkBtn.disabled = false;
    el.newChunkBtn.textContent = 'New random shader';
    el.dialogNew.textContent = 'New random shader';
  } else {
    shaderMode = false;
    shaderName = null;
    shaderExample = null;
    setShaderPreviewVisible(false);
    setDurationVisible(true);
    el.chunkMeta.textContent = `${chunk.filename}  (lines ${chunk.start_line}-${chunk.end_line})  •  id ${chunk.id}`;
    if (chunk.page && chunk.start_line) {
      updateUrlForCode(chunk.page, chunk.start_line);
    }
    el.newChunkBtn.disabled = false;
    el.newChunkBtn.textContent = 'New random chunk';
    el.dialogNew.textContent = 'New random chunk';
  }
  el.retryBtn.disabled = false;

  hardResetTyping();
  skipIndentationIfAtLineStart();
  el.typingBox.focus();

  if (shaderMode) {
    // Compile periodically while typing.
    glProgram = null;
    shaderDirty = true;
    tryCompileAndUseShader();
    requestAnimationFrame(renderShaderFrame);
  }
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

async function loadShaderByName(name) {
  setStatus('Loading');
  try {
    // Prefer WebContent examples when possible.
    if (name.endsWith('.html')) {
      const ex = await fetchJson(`/api/example?name=${encodeURIComponent(name)}`);
      setChunk({
        id: ex.id,
        example: ex.example,
        text: ex.fragment,
        vertex: ex.vertex,
        fragment: ex.fragment,
        start_line: ex.start_line,
        end_line: ex.end_line,
      });
      return;
    }

    // If name looks like a shader filename, try resolving it to an example.
    if (name.endsWith('.glsl')) {
      const resolved = await fetchJson(`/api/example/resolve?shader=${encodeURIComponent(name)}`);
      if (resolved?.example) {
        const ex = await fetchJson(`/api/example?name=${encodeURIComponent(resolved.example)}`);
        setChunk({
          id: ex.id,
          example: ex.example,
          text: ex.fragment,
          vertex: ex.vertex,
          fragment: ex.fragment,
          start_line: ex.start_line,
          end_line: ex.end_line,
        });
        return;
      }
    }

    // Fallback to raw shader files.
    const shader = await fetchJson(`/api/shader?name=${encodeURIComponent(name)}`);
    setChunk({
      id: shader.id,
      shader: shader.shader,
      text: shader.text,
      start_line: shader.start_line,
      end_line: shader.end_line,
    });
  } catch (e) {
    el.chunkMeta.textContent = String(e?.message || e);
    el.typingBox.textContent = '';
    setStatus('Error');
    el.retryBtn.disabled = true;
    inputEnabled = false;
  }
}

async function loadRandomShader() {
  setStatus('Loading');
  try {
    const ex = await fetchJson('/api/example/random');
    setChunk({
      id: ex.id,
      example: ex.example,
      text: ex.fragment,
      vertex: ex.vertex,
      fragment: ex.fragment,
      start_line: ex.start_line,
      end_line: ex.end_line,
    });
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
    startAttemptIfNeeded();
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
    startAttemptIfNeeded();
    acceptChar('\t');
    return;
  }

  if (ev.key === 'Enter') {
    ev.preventDefault();
    startAttemptIfNeeded();
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
    startAttemptIfNeeded();
    acceptChar(ev.key);
    return;
  }
});

el.newChunkBtn.addEventListener('click', async () => {
  if (shaderMode) {
    await loadRandomShader();
  } else {
    await loadRandomChunk();
  }
});

el.retryBtn.addEventListener('click', async () => {
  if (!currentChunk) return;
  if (currentChunk.example) {
    await loadShaderByName(currentChunk.example);
    return;
  }
  if (currentChunk.shader) {
    await loadShaderByName(currentChunk.shader);
    return;
  }
  if (currentChunk.page && currentChunk.start_line) {
    await loadChunkByLocation(currentChunk.page, currentChunk.start_line);
    return;
  }
  if (currentChunk.id) await loadChunkById(currentChunk.id);
});

el.resultsDialog.addEventListener('close', async () => {
  const action = el.resultsDialog.returnValue;
  if (action === 'retry') {
    if (currentChunk?.example) {
      await loadShaderByName(currentChunk.example);
    } else if (currentChunk?.shader) {
      await loadShaderByName(currentChunk.shader);
    } else if (currentChunk?.page && currentChunk?.start_line) {
      await loadChunkByLocation(currentChunk.page, currentChunk.start_line);
    } else if (currentChunk?.id) {
      await loadChunkById(currentChunk.id);
    }
  } else if (action === 'new') {
    if (shaderMode) {
      await loadRandomShader();
    } else {
      await loadRandomChunk();
    }
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

  const example = getInitialExampleFromUrl();
  if (example) {
    shaderMode = true;
    setShaderPreviewVisible(true);
    setDurationVisible(false);
    el.newChunkBtn.textContent = 'New random shader';
    el.dialogNew.textContent = 'New random shader';
    setupShaderUiIfNeeded();
    await loadShaderByName(example);
    return;
  }

  const s = getInitialShaderFromUrl();
  if (s) {
    shaderMode = true;
    setShaderPreviewVisible(true);
    setDurationVisible(false);
    el.newChunkBtn.textContent = 'New random shader';
    el.dialogNew.textContent = 'New random shader';
    setupShaderUiIfNeeded();
    await loadShaderByName(s);
    return;
  }

  const loc = getInitialLocationFromUrl();
  if (loc) {
    await loadChunkByLocation(loc.page, loc.line);
  } else {
    await loadRandomChunk();
  }
});
