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

// After finishing a token, require a single space keypress to advance.
let awaitingSpace = false;
let pendingJump = null;

// Virtual ENG-ESP keyboard: support dead-key accents using an ENG-US physical keyboard.
// Dead keys here are triggered using convenient US keys:
// - apostrophe (') => acute accent: á é í ó ú
// - double quote (") => diaeresis: ü
let deadKey = null; // 'acute' | 'diaeresis' | null

const ACUTE_MAP = {
  a: 'á',
  e: 'é',
  i: 'í',
  o: 'ó',
  u: 'ú',
  A: 'Á',
  E: 'É',
  I: 'Í',
  O: 'Ó',
  U: 'Ú',
};

const DIAERESIS_MAP = {
  u: 'ü',
  U: 'Ü',
};

function isLetterChar(ch) {
  return typeof ch === 'string' && ch.length === 1 && /[a-zA-Z]/.test(ch);
}

function shouldUppercaseFromModifiers(ev, ch) {
  if (!isLetterChar(ch)) return ch === String(ch).toUpperCase();
  try {
    const shift = Boolean(ev.getModifierState && ev.getModifierState('Shift'));
    const caps = Boolean(ev.getModifierState && ev.getModifierState('CapsLock'));
    return shift !== caps;
  } catch {
    return ch === ch.toUpperCase();
  }
}

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
let oskShifted = false;

let datasetItems = null;

const el = {
  sentenceMeta: document.getElementById('sentenceMeta'),
  englishTypingBox: document.getElementById('englishTypingBox'),
  typingBox: document.getElementById('typingBox'),
  timeLeft: document.getElementById('timeLeft'),
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

  applyOskLayoutForActiveLang();
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

function expectedCharAtActiveCursor() {
  const isSp = activeLang === 'sp';
  const text = isSp ? spText : enText;
  const cursor = isSp ? spCursorIndex : enCursorIndex;
  if (!text) return null;
  if (!Number.isFinite(cursor)) return null;
  if (cursor < 0 || cursor >= text.length) return null;
  return text[cursor];
}

function mapUsCodeToVirtualEsChar(ev) {
  // Spanish-row virtualization for an ENG-US physical keyboard.
  // This is position-based (event.code) to match the on-screen Spanish layout.
  const shift = Boolean(ev.shiftKey || (ev.getModifierState && ev.getModifierState('Shift')));

  switch (ev.code) {
    // US: -/_  => ES: '/?'
    case 'Minus':
      return shift ? '?' : "'";
    // US: =/+  => ES: ¡/¿
    case 'Equal':
      return shift ? '¿' : '¡';

    // US: [/{  => ES: ` /^  (per OSK layout)
    case 'BracketLeft':
      return shift ? '^' : '`';
    // US: ]/}  => ES: + /*  (per OSK layout)
    case 'BracketRight':
      return shift ? '*' : '+';
    // US: \/|  => ES: ç/Ç  (per OSK layout)
    case 'Backslash':
      return shift ? 'Ç' : 'ç';

    // US: ;/:  => ES: ñ/Ñ
    case 'Semicolon':
      return shift ? 'Ñ' : 'ñ';
    // US: '/"  => ES: ´/¨ (accent dead-keys)
    case 'Quote':
      return shift ? '¨' : '´';

    // US: ,/<  => ES: ,/;
    case 'Comma':
      return shift ? ';' : ',';
    // US: ./>  => ES: ./: 
    case 'Period':
      return shift ? ':' : '.';
    // US: //?  => ES: -/_
    case 'Slash':
      return shift ? '_' : '-';

    default:
      return ev.key;
  }
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
    layout: OSK_LAYOUTS.es,
    display: {
      '{bksp}': '⌫',
      '{enter}': '⏎',
      '{shift}': '⇧',
      '{space}': 'space',
    },
    layoutName: 'default',
  });

  oskShifted = false;
  applyOskLayoutForActiveLang();
}

function setOskLayoutName(name) {
  oskShifted = name === 'shift';
  applyOskLayoutForActiveLang();
}

const OSK_LAYOUTS = {
  // Matches the Spanish layout we were already using.
  es: {
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
  // Standard US English QWERTY for visualization on the English row.
  en: {
    default: [
      '1 2 3 4 5 6 7 8 9 0 - = {bksp}',
      'q w e r t y u i o p [ ] \\',
      'a s d f g h j k l ; \' {enter}',
      '{shift} z x c v b n m , . / {shift}',
      '{space}',
    ],
    shift: [
      '! @ # $ % ^ & * ( ) _ + {bksp}',
      'q w e r t y u i o p { } |',
      'a s d f g h j k l : " {enter}',
      '{shift} z x c v b n m < > ? {shift}',
      '{space}',
    ],
  },
};

function applyOskLayoutForActiveLang() {
  if (!osk) return;
  const lang = activeLang === 'sp' ? 'es' : 'en';
  const name = oskShifted ? 'shift' : 'default';
  try {
    osk.setOptions({ layout: OSK_LAYOUTS[lang], layoutName: name });
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
    elBtn.classList.add('hg-activeButton');
    if (oskClearTimers.has(elBtn)) clearTimeout(oskClearTimers.get(elBtn));
    const t = setTimeout(() => {
      elBtn.classList.remove('hg-activeButton');
      oskClearTimers.delete(elBtn);
    }, 75);
    oskClearTimers.set(elBtn, t);
  }
}

function nowMs() {
  return performance.now();
}

function resetTimerUi() {
  el.timeLeft.textContent = `${durationSeconds.toFixed(1)}`;
}

function totalDurationMs() {
  return durationSeconds * 1000;
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function updateTimerUi(elapsedMs) {
  const leftMs = Math.max(0, totalDurationMs() - elapsedMs);
  el.timeLeft.textContent = `${(leftMs / 1000).toFixed(1)}`;
}

function computeResults(elapsedMs) {
  const minutes = Math.max(0.0001, elapsedMs / 60000);
  const cpm = roundNonSpace / minutes;
  const wpm = toWpmFromCpm(cpm);
  const accuracy = roundTyped ? (roundCorrect / roundTyped) * 100 : 0;
  const score = wpm * (accuracy / 100);
  return { wpm, accuracy, score };
}

function getSavedHighScore() {
  const raw = localStorage.getItem(LEARN_HIGHSCORE_KEY);
  const n = Number(raw);
  if (Number.isFinite(n)) return n;

  // Migrate legacy CPM-based key once.
  const old = Number(localStorage.getItem(LEARN_HIGHSCORE_KEY_V1));
  if (Number.isFinite(old) && old > 0) {
    const migrated = toWpmFromCpm(old);
    localStorage.setItem(LEARN_HIGHSCORE_KEY, String(migrated));
    localStorage.removeItem(LEARN_HIGHSCORE_KEY_V1);
    return migrated;
  }

  return 0;
}

function setHighScore(value) {
  localStorage.setItem(LEARN_HIGHSCORE_KEY, String(value));
}

function setHighScoreUi(value) {
  if (!el.highScore) return;
  el.highScore.textContent = Number(value).toFixed(1);
}

function setLastRoundUi(result) {
  if (el.lastCpm) el.lastCpm.textContent = Number(result.wpm).toFixed(1);
  if (el.lastAcc) el.lastAcc.textContent = `${Number(result.accuracy).toFixed(1)}%`;
  if (el.lastScore) el.lastScore.textContent = Number(result.score).toFixed(1);
}

function saveLastResult(result) {
  try {
    localStorage.setItem(LEARN_LASTRESULT_KEY, JSON.stringify(result));
    localStorage.removeItem(LEARN_LASTRESULT_KEY_V1);
  } catch {
    // Ignore.
  }
}

function loadLastResult() {
  try {
    const raw = localStorage.getItem(LEARN_LASTRESULT_KEY);
    if (raw) return JSON.parse(raw);

    // Migrate legacy CPM-based value once.
    const oldRaw = localStorage.getItem(LEARN_LASTRESULT_KEY_V1);
    if (!oldRaw) return null;
    const old = JSON.parse(oldRaw);
    if (!old || typeof old !== 'object') return null;
    const migrated = {
      wpm: toWpmFromCpm(old.wpm ?? old.cpm ?? 0),
      accuracy: Number(old.accuracy ?? 0),
      score: toWpmFromCpm(old.score ?? old.cpm ?? 0),
    };
    localStorage.setItem(LEARN_LASTRESULT_KEY, JSON.stringify(migrated));
    localStorage.removeItem(LEARN_LASTRESULT_KEY_V1);
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

    if (awaitingSpace) {
      setCurrentStep(stepIndex);
      return;
    }

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

    // Token complete -> require a space before jumping to next token or flipping/advancing.
    if (cursor >= r.end) {
      const jump = {};

      if (activeTokenPos + 1 < list.length) {
        // Next token on the same side.
        jump.lang = activeLang;
        jump.stepIndex = stepIndex;
        jump.tokenPos = activeTokenPos + 1;
        const nextR = ranges[list[jump.tokenPos]];
        jump.cursor = nextR ? nextR.start : cursor;
      } else if (isSp) {
        // Finished Spanish side for this group.
        activeTokenPos = 0;
        if (Array.isArray(step.enTokens) && step.enTokens.length) {
          jump.lang = 'en';
          jump.stepIndex = stepIndex;
          jump.tokenPos = 0;
          const first = step.enTokens[0];
          const firstR = enTokenRanges[first];
          jump.cursor = firstR ? firstR.start : 0;
        } else {
          // No English tokens -> advance directly to next group (Spanish).
          const nextStepIndex = stepIndex + 1;
          if (nextStepIndex >= stepPlan.length) {
            stepIndex = nextStepIndex;
            setCurrentStep(stepIndex);
            continue;
          }
          const nextStep = stepPlan[nextStepIndex];
          const first = nextStep?.spTokens?.[0];
          const firstR = spTokenRanges[first];
          jump.lang = 'sp';
          jump.stepIndex = nextStepIndex;
          jump.tokenPos = 0;
          jump.cursor = firstR ? firstR.start : 0;
        }
      } else {
        // Finished English side for this group -> advance to next group (Spanish).
        const nextStepIndex = stepIndex + 1;
        if (nextStepIndex >= stepPlan.length) {
          stepIndex = nextStepIndex;
          setCurrentStep(stepIndex);
          continue;
        }
        const nextStep = stepPlan[nextStepIndex];
        const first = nextStep?.spTokens?.[0];
        const firstR = spTokenRanges[first];
        jump.lang = 'sp';
        jump.stepIndex = nextStepIndex;
        jump.tokenPos = 0;
        jump.cursor = firstR ? firstR.start : 0;
      }

      awaitingSpace = true;
      pendingJump = jump;
      if (isSp) spCursorIndex = cursor;
      else enCursorIndex = cursor;
      setCurrentStep(stepIndex);
      return;
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
  deadKey = null;

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
  awaitingSpace = false;
  pendingJump = null;
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

function acceptSpaceToAdvance() {
  if (!awaitingSpace || !pendingJump) return false;

  const isSp = activeLang === 'sp';
  const text = isSp ? spText : enText;
  const buf = isSp ? spTypedBuffer : enTypedBuffer;

  let cursor = isSp ? spCursorIndex : enCursorIndex;
  cursor = Math.max(0, Math.min(text.length, cursor));

  // Only consume a space keypress to advance.
  if (cursor < text.length && text[cursor] !== ' ') {
    // If the underlying text has no space here (should be rare), still require
    // the keypress but don't write past bounds.
  }

  roundTyped += 1;
  const expected = cursor < text.length ? text[cursor] : ' ';
  if (expected === ' ') roundCorrect += 1;

  if (cursor < text.length) buf[cursor] = ' ';
  cursor += 1;

  // Jump to the pending destination.
  const dest = pendingJump;
  awaitingSpace = false;
  pendingJump = null;

  // If we're staying on this side, auto-fill any extra spaces up to the target cursor.
  if (dest.lang === activeLang) {
    const target = Math.max(0, Math.min(text.length, Number(dest.cursor) || 0));
    for (let i = cursor; i < target && i < text.length; i += 1) {
      if (text[i] === ' ') buf[i] = ' ';
    }
    cursor = target;
    activeTokenPos = Number.isFinite(dest.tokenPos) ? dest.tokenPos : activeTokenPos;
    stepIndex = Number.isFinite(dest.stepIndex) ? dest.stepIndex : stepIndex;
    if (isSp) spCursorIndex = cursor;
    else enCursorIndex = cursor;
    setCurrentStep(stepIndex);
    advanceIfNeeded();
    return true;
  }

  // Switching sides.
  if (isSp) spCursorIndex = cursor;
  else enCursorIndex = cursor;

  stepIndex = Number.isFinite(dest.stepIndex) ? dest.stepIndex : stepIndex;
  activeTokenPos = Number.isFinite(dest.tokenPos) ? dest.tokenPos : 0;
  setActiveLang(dest.lang);

  if (dest.lang === 'sp') {
    spCursorIndex = Math.max(0, Math.min(spText.length, Number(dest.cursor) || 0));
  } else {
    enCursorIndex = Math.max(0, Math.min(enText.length, Number(dest.cursor) || 0));
  }

  setCurrentStep(stepIndex);
  advanceIfNeeded();
  return true;
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

function startAttemptIfNeeded() {
  if (timerRunning) return;
  timerRunning = true;
  startTs = nowMs();
  setStatus('Running');

  stopTimer();
  timerInterval = setInterval(() => {
    const elapsedMs = nowMs() - startTs;
    updateTimerUi(elapsedMs);

    if (elapsedMs >= totalDurationMs()) {
      stopTimer();
      timerRunning = false;
      inputEnabled = false;
      setStatus('Done');
      showResults(elapsedMs);
    }
  }, 50);
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

  if (ch === ' ' && acceptSpaceToAdvance()) {
    finishSentenceIfDone();
    updateRenderFromBuffers();
    return;
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
  // Only allow space when we're specifically awaiting it to advance.
  if (ch === ' ') return;
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

  deadKey = null;

  if (awaitingSpace) {
    awaitingSpace = false;
    pendingJump = null;
  }

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
    oskShifted = true;
    setOskLayoutName('shift');
  }

  // We run a virtual keyboard layer; don't let the browser handle input.
  // (We still allow modifier combos like Ctrl/Cmd shortcuts to pass through.)
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;

  const isSpanishRow = activeLang === 'sp';
  const virtualChar = isSpanishRow ? mapUsCodeToVirtualEsChar(ev) : ev.key;

  // Only run ESP virtual keyboard behavior while typing on the Spanish row.
  // On the English row, treat all keys literally.
  if (!isSpanishRow && deadKey) deadKey = null;

  if (isSpanishRow) {
    // Dead-key handling (Spanish accent keys: ´ and ¨).
    if (deadKey) {
      // Pressing space after the dead-key emits the marker itself.
      if (ev.key === ' ') {
        ev.preventDefault();
        const marker = deadKey === 'acute' ? '´' : '¨';
        deadKey = null;
        acceptChar(marker);
        return;
      }

      if (virtualChar && virtualChar.length === 1) {
        ev.preventDefault();
        const wantUpper = shouldUppercaseFromModifiers(ev, virtualChar);
        const k = String(virtualChar);
        const lower = k.toLowerCase();
        const combinedLower = (deadKey === 'acute')
          ? ACUTE_MAP[lower]
          : (deadKey === 'diaeresis' ? DIAERESIS_MAP[lower] : null);
        const combined = combinedLower ? (wantUpper ? combinedLower.toUpperCase() : combinedLower) : null;
        const marker = deadKey === 'acute' ? '´' : '¨';
        deadKey = null;

        if (combined) {
          acceptChar(combined);
          return;
        }

        // Not combinable: emit the marker then the typed key.
        acceptChar(marker);
        acceptChar(virtualChar);
        return;
      }

      // Non-printable key cancels the dead-key.
      deadKey = null;
    }
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

  if (isSpanishRow) {
    // Start dead-key mode when the Spanish accent keys are pressed.
    if (virtualChar === '´') {
      ev.preventDefault();
      deadKey = 'acute';
      return;
    }

    if (virtualChar === '¨') {
      ev.preventDefault();
      deadKey = 'diaeresis';
      return;
    }
  }

  if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
    ev.preventDefault();
    if (isSpanishRow) acceptChar(virtualChar);
    else acceptChar(ev.key);
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

async function ensureDatasetLoaded() {
  if (Array.isArray(datasetItems) && datasetItems.length) return;
  setMeta('Loading dataset…');
  const res = await fetch('./trimmed_sentence_groups.jsonl', { headers: { 'Accept': 'text/plain' } });
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

window.addEventListener('load', async () => {
  initOnscreenKeyboard();

  setHighScoreUi(getSavedHighScore());
  const last = loadLastResult();
  if (last) setLastRoundUi(last);

  startNewRound();
});
