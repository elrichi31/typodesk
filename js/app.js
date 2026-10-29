/* ==========================================================================
   typodesk — lógica de la aplicación
   Un test de mecanografía con filtro de letras, al estilo monkeytype.
   ========================================================================== */

(() => {
  "use strict";

  /* ----------------------------------------------------------------------
     Datos y constantes
     ---------------------------------------------------------------------- */

  const DATA = window.TYPO_WORDS || { common: [], extra: [] };
  const RARE = window.TYPO_RARE || [];
  const ALPHABET = [..."abcdefghijklmnñopqrstuvwxyz"];
  const KB_ROWS = ["qwertyuiop", "asdfghjklñ", "zxcvbnm"];
  const VOWEL_LIST = [..."aeiou"];
  const VOWEL_SET = new Set(VOWEL_LIST);

  const ACCENTS = {
    á: "a", à: "a", ä: "a", â: "a", ã: "a",
    é: "e", è: "e", ë: "e", ê: "e",
    í: "i", ì: "i", ï: "i", î: "i",
    ó: "o", ò: "o", ö: "o", ô: "o", õ: "o",
    ú: "u", ù: "u", ü: "u", û: "u",
  };

  const foldChar = (ch) => {
    const c = ch.toLowerCase();
    return ACCENTS[c] ?? c;
  };
  const foldWord = (word) => {
    let out = "";
    for (const c of word) out += foldChar(c);
    return out;
  };
  const stripAccents = (word) => {
    let out = "";
    for (const c of word) {
      const lower = c.toLowerCase();
      const plain = ACCENTS[lower];
      if (!plain) {
        out += c;
      } else {
        out += c === lower ? plain : plain.toUpperCase();
      }
    }
    return out;
  };

  // ¿el carácter escrito coincide con el esperado?
  const accentsOn = () => settings.accents;

  const sameChar = (typed, expected) =>
    accentsOn()
      ? typed.toLowerCase() === expected.toLowerCase()
      : foldChar(typed) === foldChar(expected);

  const STORAGE_KEY = "typodesk:settings:v1";
  const STATS_KEY = "typodesk:letters:v1";
  const PAIRS_KEY = "typodesk:pairs:v1";
  const HISTORY_KEY = "typodesk:history:v1";
  const BEST_KEY = "typodesk:best:v1";
  const HISTORY_MAX = 300;

  // dedo que pulsa cada tecla (0 meñique izq. … 7 meñique der.)
  const FINGER_OF = {};
  [
    ["q a z", 0], ["w s x", 1], ["e d c", 2], ["r f v t g b", 3],
    ["y h n u j m", 4], ["i k", 5], ["o l", 6], ["p ñ", 7],
  ].forEach(([letters, finger]) => {
    for (const c of letters.split(" ")) FINGER_OF[c] = finger;
  });
  const FINGER_COLORS = [
    "#e06c75", "#e5a04b", "#d6c34a", "#6fbf73", "#4fb3c8", "#6b8de3", "#a07be0", "#d66fb4",
  ];

  const readJSON = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
    } catch {
      return fallback;
    }
  };
  const writeJSON = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* modo privado: seguimos sin guardar */
    }
  };

  const THEMES = ["serika", "dracula", "nord", "paper"];

  const PRESETS = {
    all: ALPHABET.join(""),
    none: "",
    home: "asdfghjklñ",
    top: "qwertyuiop",
    bottom: "zxcvbnm",
    left: "qwertasdfgzxcvb",
    right: "yuiophjklnmñ",
  };

  const FILTER_LABELS = {
    subset: "solo estas letras",
    all: "contiene todas",
    any: "contiene alguna",
  };

  const DEFAULT_SETTINGS = {
    mode: "time",
    time: 30,
    count: 25,
    punctuation: false,
    accents: false,
    blockErrors: true,
    module: "speed",
    fingers: false,
    filter: "subset",
    letters: ALPHABET.join(""),
    vowels: true,
    words: "real",
    sound: false,
    theme: "serika",
  };

  /* ----------------------------------------------------------------------
     Ajustes persistentes
     ---------------------------------------------------------------------- */

  function loadSettings() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
    } catch {
      saved = {};
    }

    const s = { ...DEFAULT_SETTINGS, ...saved };

    if (!["time", "words"].includes(s.mode)) s.mode = "time";
    if (!["subset", "all", "any"].includes(s.filter)) s.filter = "subset";
    if (!["real", "syllables"].includes(s.words)) s.words = "real";
    s.fingers = Boolean(s.fingers);
    if (!THEMES.includes(s.theme)) s.theme = "serika";

    s.time = [15, 30, 60, 120].includes(Number(s.time)) ? Number(s.time) : 30;
    s.count = [10, 25, 50, 100].includes(Number(s.count)) ? Number(s.count) : 25;
    s.punctuation = Boolean(s.punctuation);
    s.accents = Boolean(s.accents);
    s.blockErrors = s.blockErrors !== false;
    s.vowels = s.vowels !== false;
    if (!["speed", "practice"].includes(s.module)) s.module = "speed";
    s.sound = Boolean(s.sound);

    const letters = [...String(s.letters ?? "")]
      .map((c) => c.toLowerCase())
      .filter((c) => ALPHABET.includes(c));
    s.letters = ALPHABET.filter((c) => letters.includes(c)).join("");

    return s;
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* modo privado: seguimos sin guardar */
    }
  }

  let settings = loadSettings();

  /* ----------------------------------------------------------------------
     Estadísticas por letra (intentos y fallos) para el mapa de calor
     ---------------------------------------------------------------------- */

  const cleanCounter = (raw) => {
    const n = Math.max(0, Number(raw?.n) || 0);
    return { n, e: Math.min(Math.max(0, Number(raw?.e) || 0), n) };
  };

  function loadLetterStats() {
    const saved = readJSON(STATS_KEY, {});
    const stats = {};
    for (const c of ALPHABET) stats[c] = cleanCounter(saved[c]);
    return stats;
  }

  // fallos por par de letras consecutivas ("rt", "nt"…)
  function loadPairStats() {
    const saved = readJSON(PAIRS_KEY, {});
    const pairs = {};
    for (const [pair, raw] of Object.entries(saved)) {
      if (/^[a-zñ]{2}$/.test(pair)) pairs[pair] = cleanCounter(raw);
    }
    return pairs;
  }

  let letterStats = loadLetterStats();
  let pairStats = loadPairStats();

  function saveLetterStats() {
    writeJSON(STATS_KEY, letterStats);
    writeJSON(PAIRS_KEY, pairStats);
  }

  // tasa de fallos (0..1); sin datos suficientes devuelve null
  const MIN_SAMPLES = 3;
  const rateOf = (st) => (st && st.n >= MIN_SAMPLES ? st.e / st.n : null);
  const letterRate = (c) => rateOf(letterStats[c]);

  const snapshot = () => ({
    letters: JSON.parse(JSON.stringify(letterStats)),
    pairs: JSON.parse(JSON.stringify(pairStats)),
  });

  // peso para elegir palabras: 1 base, hasta +3 por fallos y hasta +30 por tener
  // pocos intentos (así k, w… salen seguido hasta que las hayas practicado)
  const letterWeight = (c) =>
    1 + 12 * (letterRate(c) ?? 0) + 30 / (1 + letterStats[c].n / 5);
  const practicing = () => settings.module === "practice";
  const adaptive = practicing;

  /* ----------------------------------------------------------------------
     Referencias al DOM
     ---------------------------------------------------------------------- */

  const $ = (id) => document.getElementById(id);

  const ui = {
    body: document.body,
    app: $("app"),
    brand: $("brand"),
    btnTheme: $("btnTheme"),
    btnSound: $("btnSound"),
    btnLetters: $("btnLetters"),
    config: $("config"),
    cfgPunct: $("cfgPunct"),
    cfgAccents: $("cfgAccents"),
    cfgBlock: $("cfgBlock"),
    amountTime: $("amountTime"),
    amountWords: $("amountWords"),
    cfgLetters: $("cfgLetters"),
    lettersBadge: $("lettersBadge"),
    panel: $("panel"),
    keyboard: $("keyboard"),
    presets: $("presets"),
    filterSeg: $("filterSeg"),
    typeSeg: $("typeSeg"),
    vowelsSwitch: $("vowelsSwitch"),
    vowelsToggle: $("vowelsToggle"),
    blockSwitch: $("blockSwitch"),
    blockToggle: $("blockToggle"),
    poolInfo: $("poolInfo"),
    btnClosePanel: $("btnClosePanel"),
    typing: $("typing"),
    live: $("live"),
    liveMain: $("liveMain"),
    liveUnit: $("liveUnit"),
    liveWpm: $("liveWpm"),
    liveAcc: $("liveAcc"),
    wordsClip: $("wordsClip"),
    words: $("words"),
    caret: document.createElement("div"),
    empty: $("empty"),
    btnEmptyFix: $("btnEmptyFix"),
    hint: $("hint"),
    moduleSeg: $("moduleSeg"),
    minikb: $("minikb"),
    minikbWrap: document.querySelector(".minikb-wrap"),
    btnResetStats: $("btnResetStats"),
    btnFingers: $("btnFingers"),
    btnHistory: $("btnHistory"),
    history: $("history"),
    historyChart: $("historyChart"),
    historyStats: $("historyStats"),
    btnClearHistory: $("btnClearHistory"),
    btnCloseHistory: $("btnCloseHistory"),
    resRecord: $("resRecord"),
    resPractice: $("resPractice"),
    results: $("results"),
    resEyebrow: $("resEyebrow"),
    rWpm: $("rWpm"),
    rAcc: $("rAcc"),
    rStats: $("resStats"),
    chart: $("chart"),
    btnAgain: $("btnAgain"),
    btnChangeLetters: $("btnChangeLetters"),
  };

  ui.caret.className = "caret";
  ui.caret.setAttribute("aria-hidden", "true");

  /* ----------------------------------------------------------------------
     Estado del test
     ---------------------------------------------------------------------- */

  const S = {
    words: [],
    typed: [],
    spaceOk: [],
    idx: 0,
    rendered: [],

    started: false,
    running: false,
    finished: false,

    startTime: 0,
    elapsed: 0,

    totalKeys: 0,
    goodKeys: 0,

    samples: [],
    lastSec: 0,
    lastKeys: 0,
    lastGood: 0,

    scroll: 0,
    lineHeight: 0,
    raf: 0,
    typingTimer: 0,
    lastResults: null,
  };

  let panelOpen = false;
  let regenTimer = 0;
  let poolCache = new Map();

  /* ----------------------------------------------------------------------
     Selección de letras / generación de palabras
     ---------------------------------------------------------------------- */

  function effectiveSet() {
    const set = new Set([...settings.letters]);
    if (settings.vowels && settings.filter === "subset") {
      for (const v of VOWEL_LIST) set.add(v);
    }
    return set;
  }

  function buildPool() {
    if (settings.words === "syllables") {
      return { list: [], synthetic: true };
    }

    const set = effectiveSet();
    const letters = [...settings.letters];
    let matches;

    if (settings.filter === "subset") {
      matches = (word) => {
        for (const c of word) if (!set.has(foldChar(c))) return false;
        return true;
      };
    } else if (settings.filter === "any") {
      matches = (word) => {
        const folded = foldWord(word);
        return letters.some((c) => folded.includes(c));
      };
    } else {
      matches = (word) => {
        const folded = foldWord(word);
        return letters.every((c) => folded.includes(c));
      };
    }

    const common = DATA.common.filter(matches);

    // en práctica se añaden palabras con k, w, x, z y ñ (casi no hay entre las comunes)
    const rare = practicing()
      ? RARE.concat(DATA.extra.filter((w) => /[kw]/.test(w))).filter(matches)
      : [];
    const done = (list) => ({ list: [...new Set(list.concat(rare))], synthetic: false });

    const enough = settings.filter === "subset" ? 40 : 20;
    if (common.length >= enough) return done(common);
    return done(common.concat(DATA.extra.filter(matches)));
  }

  function getPool() {
    const key = [
      settings.module,
      settings.words,
      settings.filter,
      settings.vowels ? "v" : "-",
      settings.letters,
    ].join("|");

    if (poolCache.has(key)) return poolCache.get(key);

    const pool = buildPool();
    if (poolCache.size > 24) poolCache = new Map();
    poolCache.set(key, pool);
    return pool;
  }

  const randomOf = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // elige una letra; en práctica, las que más fallas salen más seguido
  function randomLetter(list) {
    if (!adaptive()) return randomOf(list);
    const weights = list.map(letterWeight);
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < list.length; i++) {
      r -= weights[i];
      if (r <= 0) return list[i];
    }
    return list[list.length - 1];
  }

  // devuelve una función que elige un índice del pool (ponderado si hay fallos)
  function indexPicker(pool) {
    if (!adaptive()) return () => Math.floor(Math.random() * pool.length);

    const cum = new Float64Array(pool.length);
    let total = 0;
    pool.forEach((word, i) => {
      const f = foldWord(word);
      let w = 1;
      for (let k = 0; k < f.length; k++) {
        const c = f[k];
        if (letterStats[c]) w += letterWeight(c) - 1;
        // los pares que fallas pesan más (rt, nt…)
        if (k) w += 12 * (rateOf(pairStats[f[k - 1] + c]) ?? 0);
      }
      total += w;
      cum[i] = total;
    });

    return () => {
      const r = Math.random() * total;
      let lo = 0;
      let hi = cum.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] < r) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
  }

  function pickWords(pool, n) {
    if (!pool.length) return [];
    const pick = indexPicker(pool);
    const out = [];
    const used = new Set();
    let guard = 0;

    while (out.length < n && guard < n * 60) {
      const i = pick();
      guard += 1;
      if (used.has(i) && pool.length > n * 2) continue;
      used.add(i);
      out.push(pool[i]);
    }
    while (out.length < n) out.push(randomOf(pool));
    return out;
  }

  function synthWord(set) {
    const vowels = [...set].filter((c) => VOWEL_SET.has(c));
    const consonants = [...set].filter((c) => !VOWEL_SET.has(c));

    let out = "";

    if (vowels.length && consonants.length) {
      const syllables = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < syllables; i++) {
        if (Math.random() < 0.74) out += randomLetter(consonants) + randomLetter(vowels);
        else out += randomLetter(vowels) + randomLetter(consonants);
      }
    } else if (vowels.length) {
      const groups = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < groups; i++) {
        out += randomLetter(vowels) + randomLetter(vowels);
      }
    } else if (consonants.length) {
      const groups = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < groups; i++) {
        out += randomLetter(consonants) + randomLetter(consonants);
      }
    }

    return [...out].slice(0, 10).join("");
  }

  const capitalize = (word) => {
    const chars = [...word];
    return chars.length ? chars[0].toUpperCase() + chars.slice(1).join("") : word;
  };

  function decorate(words) {
    if (!settings.punctuation) return words;
    return words.map((word) => {
      const r = Math.random();
      if (r < 0.09) return capitalize(word);
      if (r < 0.17) return word + ",";
      if (r < 0.22) return "¿" + word + "?";
      if (r < 0.26) return "¡" + word + "!";
      if (r < 0.32) return word + ".";
      return word;
    });
  }

  function buildWordList(n) {
    if (settings.words === "syllables") {
      const set = effectiveSet();
      if (!set.size) return [];
      const out = [];
      let guard = 0;
      while (out.length < n && guard < n * 40) {
        guard += 1;
        const word = synthWord(set);
        if (word) out.push(word);
      }
      return out;
    }

    const pool = getPool().list;
    if (!pool.length) return [];

    const words = decorate(pickWords(pool, n));
    return accentsOn() ? words : words.map(stripAccents);
  }

  function poolCountText() {
    if (settings.words === "syllables") return "sílabas ilimitadas";
    const n = getPool().list.length;
    if (!n) return "0 palabras con esta combinación";
    return `${n.toLocaleString("es")} ${n === 1 ? "palabra" : "palabras"} disponibles`;
  }

  /* ----------------------------------------------------------------------
     Render del test
     ---------------------------------------------------------------------- */

  function createWordEl(word, index) {
    const el = document.createElement("div");
    el.className = "word";
    el.dataset.i = String(index);

    const chars = [...word].map((c) => {
      const span = document.createElement("span");
      span.className = "ch";
      span.textContent = c;
      el.appendChild(span);
      return span;
    });

    return { el, chars, extras: [] };
  }

  function renderAll() {
    ui.words.innerHTML = "";
    S.rendered = S.words.map((word, i) => createWordEl(word, i));
    for (const r of S.rendered) ui.words.appendChild(r.el);
    ui.words.appendChild(ui.caret);
    measure();
  }

  function measure() {
    if (!S.rendered.length) {
      S.lineHeight = 0;
      ui.wordsClip.style.height = "";
      return;
    }
    S.lineHeight = S.rendered[0].el.offsetHeight || 0;
    if (S.lineHeight) {
      ui.wordsClip.style.height = `${Math.round(S.lineHeight * 3)}px`;
    }
  }

  function refreshWord(i, completed = false) {
    const r = S.rendered[i];
    if (!r) return;

    const target = [...S.words[i]];
    const typed = [...S.typed[i]];
    const total = Math.max(target.length, typed.length);

    for (let j = 0; j < total; j++) {
      if (j < target.length) {
        const span = r.chars[j];
        span.className = "ch";
        if (j < typed.length) {
          span.classList.add(sameChar(typed[j], target[j]) ? "correct" : "incorrect");
        } else if (completed) {
          span.classList.add("missed");
        }
      } else {
        const k = j - target.length;
        let span = r.extras[k];
        if (!span) {
          span = document.createElement("span");
          r.el.appendChild(span);
          r.extras[k] = span;
        }
        span.className = "ch incorrect extra";
        span.textContent = typed[j];
      }
    }

    const keep = Math.max(0, typed.length - target.length);
    while (r.extras.length > keep) {
      r.extras.pop().remove();
    }
  }

  function updateCaret() {
    const i = S.idx;
    const r = S.rendered[i];
    if (!r) {
      ui.caret.classList.add("off");
      markNext("");
      return;
    }
    ui.caret.classList.remove("off");

    const typed = [...S.typed[i]];
    const target = [...S.words[i]];
    markNext(typed.length < target.length ? foldChar(target[typed.length]) : "");
    let x = 0;
    let y = 0;

    if (typed.length < target.length) {
      const ch = r.chars[typed.length];
      x = ch.offsetLeft;
      y = ch.offsetTop;
    } else if (r.extras.length) {
      const ch = r.extras[r.extras.length - 1];
      x = ch.offsetLeft + ch.offsetWidth;
      y = ch.offsetTop;
    } else {
      const ch = r.chars[target.length - 1];
      if (ch) {
        x = ch.offsetLeft + ch.offsetWidth;
        y = ch.offsetTop;
      } else {
        x = r.el.offsetLeft;
        y = r.el.offsetTop;
      }
    }

    ui.caret.style.left = `${x}px`;
    ui.caret.style.top = `${y}px`;
    updateScroll();
  }

  function updateScroll() {
    const r = S.rendered[S.idx];
    if (!r || !S.lineHeight) return;

    const line = Math.round(r.el.offsetTop / S.lineHeight);
    const target = Math.max(0, line - 1) * S.lineHeight;

    if (Math.abs(target - S.scroll) > 0.5) {
      S.scroll = target;
      ui.words.style.transform = `translateY(${-target}px)`;
    }
  }

  function resetScroll() {
    S.scroll = 0;
    ui.words.style.transform = "translateY(0)";
  }

  /* ----------------------------------------------------------------------
     Ciclo de vida del test
     ---------------------------------------------------------------------- */

  function hideResults() {
    ui.results.hidden = true;
  }

  function showEmpty(show) {
    ui.empty.hidden = !show;
    ui.wordsClip.hidden = show;
    ui.hint.classList.toggle("gone", show);
  }

  function newTest() {
    if (S.raf) cancelAnimationFrame(S.raf);
    S.raf = 0;
    saveLetterStats();
    S.snap = snapshot();
    S.hadError = false;
    hideResults();

    S.started = false;
    S.running = false;
    S.finished = false;
    S.idx = 0;
    S.elapsed = 0;
    S.totalKeys = 0;
    S.goodKeys = 0;
    S.samples = [];
    S.lastSec = 0;
    S.lastKeys = 0;
    S.lastGood = 0;
    S.lastResults = null;

    const need = settings.mode === "time" ? 60 : settings.count;
    const words = buildWordList(need);

    S.words = words;
    S.typed = words.map(() => "");
    S.spaceOk = words.map(() => false);

    renderAll();
    resetScroll();
    showEmpty(words.length === 0);
    ui.hint.textContent = settings.blockErrors
      ? "empieza a escribir · si fallas, repite la letra hasta acertar"
      : "empieza a escribir para iniciar la prueba";
    ui.hint.classList.remove("gone");
    ui.live.classList.remove("started");
    ui.app.classList.remove("running");

    updateCaret();
    updateLiveUI();
  }

  function scheduleNewTest() {
    clearTimeout(regenTimer);
    regenTimer = setTimeout(newTest, 130);
  }

  function ensureWords() {
    if (settings.mode !== "time") return;
    if (S.words.length - S.idx >= 20) return;

    const extra = buildWordList(40);
    for (const word of extra) {
      const index = S.words.length;
      S.words.push(word);
      S.typed.push("");
      S.spaceOk.push(false);
      const r = createWordEl(word, index);
      S.rendered.push(r);
      ui.words.insertBefore(r.el, ui.caret);
    }
  }

  // en práctica, cuando fallas, las palabras que aún no llegan se vuelven a elegir
  // con tus fallos nuevos. Las ~10 siguientes no se tocan para no marear la vista.
  function refreshUpcoming() {
    const keep = S.idx + 10;
    const n = S.words.length - keep;
    if (n <= 0) return;

    const fresh = buildWordList(n);
    if (fresh.length !== n) return;

    for (let i = 0; i < n; i++) {
      const at = keep + i;
      S.words[at] = fresh[i];
      S.typed[at] = "";
      S.spaceOk[at] = false;
      const r = createWordEl(fresh[i], at);
      S.rendered[at].el.replaceWith(r.el);
      S.rendered[at] = r;
    }
  }

  function beginTest() {
    if (S.started || !S.words.length) return;
    S.started = true;
    S.running = true;
    S.startTime = performance.now();
    S.lastSec = 0;
    S.lastKeys = 0;
    S.lastGood = 0;
    S.samples = [];
    ui.live.classList.add("started");
    ui.hint.classList.add("gone");
    ui.app.classList.add("running");
    tick();
  }

  function sampleTick() {
    const sec = Math.floor(S.elapsed);
    if (sec > S.lastSec) {
      const dk = S.totalKeys - S.lastKeys;
      const dg = S.goodKeys - S.lastGood;
      S.samples.push({ raw: dk * 12, net: dg * 12 });
      S.lastSec = sec;
      S.lastKeys = S.totalKeys;
      S.lastGood = S.goodKeys;
    }
  }

  function tick() {
    if (!S.running) return;

    const now = performance.now();
    S.elapsed = (now - S.startTime) / 1000;

    sampleTick();
    updateLiveUI();

    if (settings.mode === "time" && S.elapsed >= settings.time) {
      S.elapsed = settings.time;
      finish();
      return;
    }

    S.raf = requestAnimationFrame(tick);
  }

  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }

  function updateLiveUI() {
    const started = S.started;

    if (settings.mode === "time") {
      const left =
        started && S.running ? Math.ceil(Math.max(0, settings.time - S.elapsed)) : settings.time;
      setText(ui.liveMain, String(left));
      setText(ui.liveUnit, "s");
    } else {
      const total = S.words.length || settings.count;
      const current = started ? Math.min(S.idx + 1, total) : 0;
      setText(ui.liveMain, String(current));
      setText(ui.liveUnit, `/${total}`);
    }

    const minutes = S.elapsed / 60;
    const wpm = started && minutes > 0 ? Math.round(S.goodKeys / 5 / minutes) : 0;
    const acc = S.totalKeys ? Math.round((S.goodKeys / S.totalKeys) * 100) : 100;
    setText(ui.liveWpm, String(wpm));
    setText(ui.liveAcc, String(acc));
  }

  function wordStats(i, partial) {
    const target = [...S.words[i]];
    const typed = [...S.typed[i]];
    let correct = 0;
    let incorrect = 0;
    let extra = 0;

    for (let j = 0; j < typed.length; j++) {
      if (j < target.length) {
        if (sameChar(typed[j], target[j])) correct += 1;
        else incorrect += 1;
      } else {
        extra += 1;
      }
    }

    const missed = partial ? 0 : Math.max(0, target.length - typed.length);
    return { correct, incorrect, extra, missed };
  }

  function computeResults() {
    const duration =
      settings.mode === "time" ? settings.time : Math.max(S.elapsed, 0.8);

    const last = Math.min(S.idx, S.words.length - 1);
    let correct = 0;
    let incorrect = 0;
    let extra = 0;
    let missed = 0;
    let spaces = 0;
    let perfectWords = 0;

    for (let i = 0; i <= last; i++) {
      const st = wordStats(i, i === S.idx);
      correct += st.correct;
      incorrect += st.incorrect;
      extra += st.extra;
      missed += st.missed;
      if (i < S.idx && S.spaceOk[i]) {
        spaces += 1;
        perfectWords += 1;
      }
    }

    const minutes = duration / 60;
    const wpm = (correct + spaces) / 5 / minutes;
    const raw = S.totalKeys / 5 / minutes;
    const acc = S.totalKeys ? (S.goodKeys / S.totalKeys) * 100 : 100;

    const values = S.samples.map((s) => s.raw);
    let consistency = 100;
    if (values.length > 1) {
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      if (mean > 0) {
        const variance =
          values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
        const sd = Math.sqrt(variance);
        consistency = Math.max(0, Math.min(100, 100 - (sd / mean) * 100));
      }
    }

    return {
      wpm,
      raw,
      acc,
      consistency,
      correct,
      incorrect,
      extra,
      missed,
      spaces,
      perfectWords,
      duration,
      samples: values.length ? S.samples.slice() : [{ raw: 0, net: 0 }],
    };
  }

  function finish() {
    if (S.finished) return;

    // último tramo parcial, para que el gráfico no pierda el final
    const dt = S.elapsed - S.lastSec;
    if (dt > 0.15 && S.totalKeys > S.lastKeys) {
      S.samples.push({
        raw: Math.round(((S.totalKeys - S.lastKeys) * 12) / dt),
        net: Math.round(((S.goodKeys - S.lastGood) * 12) / dt),
      });
    }

    saveLetterStats();
    S.running = false;
    S.finished = true;
    if (S.raf) cancelAnimationFrame(S.raf);
    S.raf = 0;
    ui.caret.classList.add("off");
    ui.app.classList.remove("running");

    const results = computeResults();
    results.record = saveResult(results);
    S.lastResults = results;
    showResults(results);
  }

  /* ----------------------------------------------------------------------
     Entrada de teclado
     ---------------------------------------------------------------------- */

  function typeChar(ch) {
    if (S.finished || S.idx >= S.words.length) return;

    const target = [...S.words[S.idx]];
    const typed = [...S.typed[S.idx]];
    if (typed.length > target.length + 8) return;

    if (!S.started) beginTest();
    if (!S.started) return;

    const expected = target[typed.length];
    const ok = expected !== undefined && sameChar(ch, expected);

    S.totalKeys += 1;

    if (practicing()) {
      flashMiniKey(foldChar(ch));
      if (expected !== undefined) recordLetter(expected, ok, target[typed.length - 1]);
      if (!ok) S.hadError = true;
    }

    if (settings.blockErrors && !ok) {
      // modo bloqueo: la letra se queda ahí hasta que la escribas bien
      flashError();
      playClick(false);
      updateLiveUI();
      return;
    }

    if (ok) S.goodKeys += 1;

    S.typed[S.idx] = typed.join("") + ch;

    refreshWord(S.idx);
    updateCaret();
    pulseCaret();
    playClick(ok);
    ensureWords();
    updateLiveUI();
  }

  function space() {
    if (S.finished || S.idx >= S.words.length) return;
    if (!S.started) return;

    const target = [...S.words[S.idx]];
    const typed = [...S.typed[S.idx]];
    if (!typed.length && S.idx === 0) return;

    if (settings.blockErrors && typed.length < target.length) {
      // no se puede saltar una palabra a medio escribir
      flashError();
      playClick(false);
      return;
    }

    const perfect =
      typed.length === target.length &&
      typed.every((c, j) => sameChar(c, target[j]));

    S.totalKeys += 1;
    if (perfect) S.goodKeys += 1;
    S.spaceOk[S.idx] = perfect;

    refreshWord(S.idx, true);
    S.idx += 1;
    playClick(perfect);

    if (S.hadError) {
      S.hadError = false;
      refreshUpcoming();
    }

    if (S.idx >= S.words.length) {
      if (settings.mode === "words") {
        finish();
        return;
      }
      ensureWords();
    }

    updateCaret();
    updateLiveUI();
  }

  function backspace() {
    if (S.finished) return;

    const typed = [...S.typed[S.idx]];
    if (typed.length) {
      S.typed[S.idx] = typed.slice(0, -1).join("");
      refreshWord(S.idx);
      updateCaret();
      updateLiveUI();
      return;
    }

    if (S.idx > 0) {
      S.idx -= 1;
      S.spaceOk[S.idx] = false;
      refreshWord(S.idx);
      updateCaret();
      updateLiveUI();
    }
  }

  function pulseCaret() {
    ui.caret.classList.add("typing");
    clearTimeout(S.typingTimer);
    S.typingTimer = setTimeout(() => ui.caret.classList.remove("typing"), 750);
  }

  let errorFlashTimer = 0;
  function flashError() {
    const r = S.rendered[S.idx];
    if (!r) return;

    const typedLength = [...S.typed[S.idx]].length;
    const span = r.chars[typedLength];
    if (!span) return;

    span.classList.add("wrong");
    clearTimeout(errorFlashTimer);
    errorFlashTimer = setTimeout(() => span.classList.remove("wrong"), 230);
  }

  let audioCtx = null;
  function playClick(ok) {
    if (!settings.sound) return;
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = ok ? "sine" : "square";
      osc.frequency.value = ok ? 680 : 170;
      gain.gain.setValueAtTime(0.045, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.06);
    } catch {
      /* sin sonido */
    }
  }

  function onKeyDown(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key;

    if (!ui.history.hidden) {
      if (key === "Tab" || key === "Enter" || key === "Escape") {
        event.preventDefault();
        closeHistory();
      }
      return;
    }

    if (!ui.results.hidden) {
      if (key === "Tab" || key === "Enter" || key === "Escape") {
        event.preventDefault();
        newTest();
      }
      return;
    }

    if (key === "Escape") {
      event.preventDefault();
      if (panelOpen) closePanel();
      else if (S.finished) newTest();
      return;
    }

    if (key === "Tab") {
      event.preventDefault();
      newTest();
      return;
    }

    if (panelOpen) {
      if (key.length === 1) {
        const letter = key.toLowerCase();
        if (ALPHABET.includes(letter)) {
          event.preventDefault();
          toggleLetter(letter);
        }
      }
      return;
    }

    if (key === "Backspace") {
      event.preventDefault();
      backspace();
      return;
    }

    if (key === " ") {
      event.preventDefault();
      space();
      return;
    }

    if (key.length === 1) {
      event.preventDefault();
      typeChar(key);
    }
  }

  /* ----------------------------------------------------------------------
     Resultados
     ---------------------------------------------------------------------- */

  function animateNumber(node, to, decimals = 0) {
    const duration = 700;
    const start = performance.now();
    const target = Number.isFinite(to) ? to : 0;

    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      node.textContent = (target * eased).toFixed(decimals);
      if (t < 1) requestAnimationFrame(step);
      else node.textContent = target.toFixed(decimals);
    };

    requestAnimationFrame(step);
  }

  function statRow(label, value, cls = "") {
    return `<div class="stat"><span class="k">${label}</span><span class="v ${cls}">${value}</span></div>`;
  }

  function resultsLabel() {
    const mode =
      settings.mode === "time" ? `tiempo ${settings.time}s` : `${settings.count} palabras`;
    const filter = FILTER_LABELS[settings.filter];
    const letters =
      settings.letters.length === ALPHABET.length
        ? "todas las letras"
        : settings.letters.length
          ? `letras ${[...settings.letters].join(" ")}`
          : "sin letras";
    const type = settings.words === "syllables" ? "sílabas" : "palabras reales";
    const accents = accentsOn() ? "con tildes" : "sin tildes";
    const flow = settings.blockErrors ? "errores bloqueados" : "flujo libre";
    return `${mode} · ${type} · ${accents} · ${flow} · ${filter} · ${letters}`;
  }

  // clave de la configuración: los récords se comparan solo contra la misma
  function configKey() {
    return [
      settings.module,
      settings.mode,
      settings.mode === "time" ? settings.time : settings.count,
      settings.words,
      settings.filter,
      accentsOn() ? "t" : "-",
      settings.punctuation ? "p" : "-",
      settings.letters,
    ].join("|");
  }

  // guarda la prueba en el historial y actualiza el récord de su configuración
  function saveResult(r) {
    if (r.correct + r.spaces < 5) return null;

    const cfg = configKey();
    const wpm = Math.round(r.wpm);
    const history = readJSON(HISTORY_KEY, []);
    history.push({ t: Date.now(), wpm, raw: Math.round(r.raw), acc: Math.round(r.acc), cfg, module: settings.module });
    writeJSON(HISTORY_KEY, history.slice(-HISTORY_MAX));

    const best = readJSON(BEST_KEY, {});
    const prev = best[cfg];
    if (!prev || wpm > prev.wpm) best[cfg] = { wpm, acc: Math.round(r.acc), t: Date.now() };
    writeJSON(BEST_KEY, best);

    return { prev: prev ? prev.wpm : null, isRecord: Boolean(prev) && wpm > prev.wpm };
  }

  // resumen del módulo práctica: tus letras más flojas de esta prueba y pares flojos
  function practiceSummary() {
    const snap = S.snap;
    const rows = ALPHABET.map((c) => {
      const n = letterStats[c].n - snap.letters[c].n;
      const e = letterStats[c].e - snap.letters[c].e;
      return { c, n, e, now: n ? e / n : 0, before: rateOf(snap.letters[c]) };
    })
      .filter((x) => x.n >= 3 && x.e > 0)
      .sort((a, b) => b.now - a.now)
      .slice(0, 5);

    const pct = (v) => `${Math.round(v * 100)} %`;
    const trend = (x) => {
      if (x.before === null) return '<span class="tr new">nueva</span>';
      if (x.now < x.before - 0.02) return '<span class="tr good">▼ mejor</span>';
      if (x.now > x.before + 0.02) return '<span class="tr bad">▲ peor</span>';
      return '<span class="tr">= igual</span>';
    };

    const letters = rows.length
      ? rows
          .map(
            (x) =>
              `<div class="pr-row"><b>${x.c}</b><span>${x.e} de ${x.n} · ${pct(x.now)} ${
                x.before === null ? "" : `(antes ${pct(x.before)})`
              }</span>${trend(x)}</div>`,
          )
          .join("")
      : '<div class="pr-row"><span>sin fallos en esta prueba, limpio ✓</span></div>';

    const pairs = Object.entries(pairStats)
      .map(([pair, st]) => ({ pair, rate: rateOf(st), n: st.n }))
      .filter((x) => x.rate !== null && x.rate > 0)
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 4)
      .map((x) => `<code>${x.pair}</code> ${pct(x.rate)}`)
      .join(" · ");

    return (
      `<span class="side-label">letras más flojas de esta prueba</span>${letters}` +
      (pairs ? `<span class="side-label">pares más flojos (acumulado)</span><div class="pr-pairs">${pairs}</div>` : "")
    );
  }

  function showResults(r) {
    ui.results.hidden = false;
    ui.resEyebrow.textContent = `prueba terminada · ${resultsLabel()}`;

    ui.resRecord.hidden = !r.record?.isRecord;
    if (r.record?.isRecord) ui.resRecord.textContent = `¡nuevo récord! +${Math.round(r.wpm) - r.record.prev} wpm`;

    ui.resPractice.hidden = !practicing();
    if (practicing()) ui.resPractice.innerHTML = practiceSummary();

    animateNumber(ui.rWpm, Math.round(r.wpm));
    animateNumber(ui.rAcc, Math.round(r.acc));

    ui.rStats.innerHTML = [
      statRow("prueba", `${settings.mode === "time" ? "tiempo" : "palabras"} · ${r.duration.toFixed(1)}s`),
      statRow("raw", `${Math.round(r.raw)} wpm`),
      statRow("consistencia", `${Math.round(r.consistency)}%`),
      statRow(
        "caracteres",
        `<span class="ok">${r.correct}</span> / <span class="bad">${r.incorrect}</span> / <span class="extra">${r.extra}</span> / <span class="miss">${r.missed}</span>`,
      ),
      statRow("palabras perfectas", String(r.perfectWords)),
      statRow("récord (esta config.)", r.record ? `${Math.max(r.record.prev ?? 0, Math.round(r.wpm))} wpm` : "—"),
      statRow("letras", settings.letters.length === ALPHABET.length ? "todas" : [...settings.letters].join(" ")),
    ].join("");

    requestAnimationFrame(() => {
      drawChart(r.samples);
    });
  }

  function drawChart(samples, canvas = ui.chart, labelOf = (i) => `${i + 1}s`) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 640;
    const h = canvas.clientHeight || 190;

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const css = getComputedStyle(document.body);
    const main = css.getPropertyValue("--main").trim() || "#e2b714";
    const sub = css.getPropertyValue("--sub").trim() || "#646669";
    const text = css.getPropertyValue("--text").trim() || "#d1d0c5";

    const data = samples.length > 1 ? samples : [...samples, samples[0] || { raw: 0, net: 0 }];
    const n = data.length;
    const pad = { l: 36, r: 8, t: 14, b: 20 };

    const peak = Math.max(10, ...data.map((d) => Math.max(d.raw || 0, d.net || 0)));
    const yMax = Math.max(20, Math.ceil(peak / 20) * 20);

    const x = (i) => pad.l + (i / Math.max(1, n - 1)) * (w - pad.l - pad.r);
    const y = (v) => h - pad.b - (Math.min(v, yMax) / yMax) * (h - pad.t - pad.b);

    // rejilla horizontal
    ctx.font = "10px 'JetBrains Mono', monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i++) {
      const value = (yMax / 4) * i;
      const py = y(value);
      ctx.beginPath();
      ctx.globalAlpha = 0.09;
      ctx.strokeStyle = text;
      ctx.lineWidth = 1;
      ctx.moveTo(pad.l, py + 0.5);
      ctx.lineTo(w - pad.r, py + 0.5);
      ctx.stroke();
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = sub;
      ctx.fillText(String(Math.round(value)), pad.l - 8, py);
    }
    ctx.globalAlpha = 1;

    // área bajo la curva neta
    const gradient = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
    gradient.addColorStop(0, hexToRgba(main, 0.22));
    gradient.addColorStop(1, hexToRgba(main, 0));
    ctx.beginPath();
    ctx.moveTo(x(0), h - pad.b);
    data.forEach((d, i) => ctx.lineTo(x(i), y(d.net || 0)));
    ctx.lineTo(x(n - 1), h - pad.b);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // línea raw
    ctx.beginPath();
    data.forEach((d, i) => {
      const px = x(i);
      const py = y(d.raw || 0);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = sub;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.stroke();

    // línea neta
    ctx.beginPath();
    data.forEach((d, i) => {
      const px = x(i);
      const py = y(d.net || 0);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.globalAlpha = 1;
    ctx.strokeStyle = main;
    ctx.lineWidth = 2;
    ctx.stroke();

    // puntos
    if (n <= 60) {
      ctx.fillStyle = main;
      data.forEach((d, i) => {
        ctx.beginPath();
        ctx.arc(x(i), y(d.net || 0), 2.4, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // etiquetas del eje x
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = sub;
    ctx.globalAlpha = 0.8;
    const marks = Math.min(6, n);
    for (let i = 0; i < marks; i++) {
      const idx = Math.round((i / Math.max(1, marks - 1)) * (n - 1));
      const label = labelOf(idx);
      ctx.fillText(label, Math.min(w - 18, Math.max(18, x(idx))), h - pad.b + 6);
    }
    ctx.globalAlpha = 1;
  }

  /* ----------------------------------------------------------------------
     Historial
     ---------------------------------------------------------------------- */

  function renderHistory() {
    const history = readJSON(HISTORY_KEY, []);
    const recent = history.slice(-40);
    const last10 = history.slice(-10);
    const avg = (list, key) =>
      list.length ? Math.round(list.reduce((a, x) => a + x[key], 0) / list.length) : 0;

    ui.historyStats.innerHTML = history.length
      ? [
          statRow("pruebas guardadas", String(history.length)),
          statRow("mejor", `${Math.max(...history.map((x) => x.wpm))} wpm`),
          statRow("media últimas 10", `${avg(last10, "wpm")} wpm · ${avg(last10, "acc")}%`),
          statRow("última", `${history[history.length - 1].wpm} wpm`),
        ].join("")
      : statRow("aún no hay pruebas", "termina una para verla aquí");

    requestAnimationFrame(() =>
      drawChart(
        recent.length ? recent.map((x) => ({ raw: x.raw, net: x.wpm })) : [{ raw: 0, net: 0 }],
        ui.historyChart,
        (i) => `#${history.length - recent.length + i + 1}`,
      ),
    );
  }

  function openHistory() {
    if (S.running) newTest();
    ui.history.hidden = false;
    renderHistory();
  }

  const closeHistory = () => {
    ui.history.hidden = true;
  };

  function hexToRgba(hex, alpha) {
    const clean = hex.replace("#", "");
    if (clean.length !== 6) return `rgba(226, 183, 20, ${alpha})`;
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /* ----------------------------------------------------------------------
     Interfaz: configuración y panel de letras
     ---------------------------------------------------------------------- */

  function buildKeyboard() {
    ui.keyboard.innerHTML = "";
    KB_ROWS.forEach((row, index) => {
      const rowEl = document.createElement("div");
      rowEl.className = "kb-row";
      rowEl.dataset.row = String(index);
      for (const letter of row) {
        const key = document.createElement("button");
        key.type = "button";
        key.className = "key";
        key.dataset.letter = letter;
        key.textContent = letter;
        key.setAttribute("aria-pressed", "false");
        key.addEventListener("click", () => toggleLetter(letter));
        rowEl.appendChild(key);
      }
      ui.keyboard.appendChild(rowEl);
    });
  }

  /* ----------------------------------------------------------------------
     Mini teclado (módulo práctica): teclas pulsadas + mapa de fallos
     ---------------------------------------------------------------------- */

  const miniKeys = {};

  function buildMiniKeyboard() {
    ui.minikb.innerHTML = "";
    KB_ROWS.forEach((row, index) => {
      const rowEl = document.createElement("div");
      rowEl.className = "mk-row";
      rowEl.dataset.row = String(index);
      for (const letter of row) {
        const key = document.createElement("span");
        key.className = "mk";
        key.textContent = letter;
        key.style.setProperty("--fc", FINGER_COLORS[FINGER_OF[letter]]);
        key.addEventListener("click", () => practiceOnly(letter));
        miniKeys[letter] = key;
        rowEl.appendChild(key);
      }
      ui.minikb.appendChild(rowEl);
    });
    paintMiniKeys();
  }

  // verde = tus mejores letras, rojo = las peores. La escala es relativa a tus
  // propios datos, así el rojo siempre marca lo que más te cuesta.
  function paintMiniKeys() {
    const rates = ALPHABET.map(letterRate).filter((r) => r !== null);
    const lo = rates.length ? Math.min(...rates) : 0;
    const hi = rates.length ? Math.max(...rates) : 0;
    const span = Math.max(hi - lo, 0.1);

    for (const c of ALPHABET) {
      const key = miniKeys[c];
      if (!key) continue;
      const st = letterStats[c];
      const rate = letterRate(c);

      if (rate === null) {
        key.style.removeProperty("--heat");
        key.classList.remove("heated");
        key.title = st.n ? `${c}: ${st.e} fallos de ${st.n}` : c;
        continue;
      }

      const hue = Math.round(125 * (1 - Math.min(1, (rate - lo) / span)));
      key.style.setProperty("--heat", `hsl(${hue} 62% 40%)`);
      key.classList.add("heated");
      key.title = `${c}: ${st.e} fallos de ${st.n} (${Math.round(rate * 100)} %)`;
    }
  }

  // tecla siguiente resaltada (solo con «dedos» activado)
  let nextKey = null;
  function markNext(letter) {
    nextKey?.classList.remove("next");
    nextKey = settings.fingers && practicing() ? miniKeys[letter] || null : null;
    nextKey?.classList.add("next");
  }

  // clic en una tecla del mini teclado: practicar solo esa letra (otro clic, volver)
  function practiceOnly(letter) {
    if (!practicing()) return;
    const focused = settings.letters === letter && settings.filter === "any";
    settings.letters = focused ? ALPHABET.join("") : letter;
    settings.filter = focused ? "subset" : "any";
    saveSettings();
    syncUI();
    newTest();
  }

  function flashMiniKey(letter) {
    const key = miniKeys[letter];
    if (!key) return;
    key.classList.add("press");
    clearTimeout(key._t);
    key._t = setTimeout(() => key.classList.remove("press"), 120);
  }

  // registra un intento sobre la letra esperada (solo en el módulo práctica)
  function recordLetter(expected, ok, prev) {
    if (!practicing()) return;
    const c = foldChar(expected);
    const st = letterStats[c];
    if (!st) return;
    st.n += 1;
    if (!ok) st.e += 1;

    const before = prev ? foldChar(prev) : "";
    if (letterStats[before]) {
      const pair = (pairStats[before + c] ||= { n: 0, e: 0 });
      pair.n += 1;
      if (!ok) pair.e += 1;
    }
    paintMiniKeys();
  }

  function toggleLetter(letter) {
    const set = new Set([...settings.letters]);
    if (set.has(letter)) set.delete(letter);
    else set.add(letter);
    settings.letters = ALPHABET.filter((c) => set.has(c)).join("");
    saveSettings();
    syncUI();
    scheduleNewTest();
  }

  function applyPreset(name) {
    settings.letters = PRESETS[name] ?? "";
    settings.filter = "subset";
    saveSettings();
    syncUI();
    scheduleNewTest();
  }

  function setFilter(filter) {
    settings.filter = filter;
    saveSettings();
    syncUI();
    scheduleNewTest();
  }

  function setType(type) {
    settings.words = type;
    saveSettings();
    syncUI();
    scheduleNewTest();
  }

  function setMode(mode) {
    settings.mode = mode;
    saveSettings();
    syncUI();
    newTest();
  }

  function syncUI() {
    // config
    ui.cfgPunct.classList.toggle("active", settings.punctuation);
    ui.cfgPunct.setAttribute("aria-pressed", String(settings.punctuation));

    ui.cfgAccents.classList.toggle("active", accentsOn());
    ui.cfgAccents.setAttribute("aria-pressed", String(accentsOn()));
    ui.cfgAccents.title = accentsOn()
      ? "Tildes activadas: escribe á, é, í, ó, ú y ü tal cual"
      : "Tildes desactivadas: las palabras se muestran sin acentos";

    ui.cfgBlock.classList.toggle("active", settings.blockErrors);
    ui.cfgBlock.setAttribute("aria-pressed", String(settings.blockErrors));
    ui.cfgBlock.title = settings.blockErrors
      ? "Errores bloqueados: debes escribir bien la letra para avanzar"
      : "Flujo libre: puedes fallar y seguir escribiendo";

    for (const btn of ui.config.querySelectorAll("[data-mode]")) {
      const on = btn.dataset.mode === settings.mode;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", String(on));
    }

    ui.amountTime.hidden = settings.mode !== "time";
    ui.amountWords.hidden = settings.mode !== "words";

    for (const btn of ui.amountTime.querySelectorAll("[data-time]")) {
      const on = Number(btn.dataset.time) === settings.time;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", String(on));
    }

    for (const btn of ui.amountWords.querySelectorAll("[data-count]")) {
      const on = Number(btn.dataset.count) === settings.count;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", String(on));
    }

    ui.lettersBadge.textContent = String(settings.letters.length);
    ui.cfgLetters.title =
      settings.letters.length === ALPHABET.length
        ? "Todas las letras seleccionadas"
        : `Letras: ${[...settings.letters].join(" ")}`;

    // panel: filtros
    for (const btn of ui.filterSeg.querySelectorAll("[data-filter]")) {
      const on = btn.dataset.filter === settings.filter;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", String(on));
    }

    for (const btn of ui.typeSeg.querySelectorAll("[data-type]")) {
      const on = btn.dataset.type === settings.words;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", String(on));
    }

    // panel: teclas
    for (const key of ui.keyboard.querySelectorAll(".key")) {
      const on = settings.letters.includes(key.dataset.letter);
      key.classList.toggle("on", on);
      key.setAttribute("aria-pressed", String(on));
    }

    // panel: vocales
    ui.vowelsToggle.checked = settings.vowels;
    ui.vowelsSwitch.classList.toggle("disabled", settings.filter !== "subset");
    ui.vowelsSwitch.title =
      settings.filter === "subset"
        ? "Añade las vocales para que las palabras suenen naturales"
        : "Solo se aplica al modo «solo estas»";

    ui.blockToggle.checked = settings.blockErrors;

    ui.poolInfo.textContent = poolCountText();
    ui.poolInfo.classList.toggle("warn", settings.words !== "syllables" && getPool().list.length === 0);

    for (const btn of ui.moduleSeg.querySelectorAll("[data-module]")) {
      const on = btn.dataset.module === settings.module;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", String(on));
    }
    ui.minikbWrap.hidden = !practicing();
    ui.minikb.classList.toggle("fingers", settings.fingers);
    ui.btnFingers.classList.toggle("on", settings.fingers);
    for (const c of ALPHABET) {
      miniKeys[c]?.classList.toggle("focus", settings.letters === c && settings.filter === "any");
    }

    ui.btnSound.classList.toggle("muted", !settings.sound);
    ui.btnSound.classList.toggle("active", settings.sound);
  }

  function openPanel() {
    if (S.running) newTest();
    panelOpen = true;
    ui.panel.classList.add("open");
    ui.cfgLetters.classList.add("active");
    ui.btnLetters.classList.add("active");
    syncUI();
  }

  function closePanel() {
    panelOpen = false;
    ui.panel.classList.remove("open");
    ui.cfgLetters.classList.remove("active");
    ui.btnLetters.classList.remove("active");
    updateCaret();
  }

  function togglePanel() {
    if (panelOpen) closePanel();
    else openPanel();
  }

  /* ----------------------------------------------------------------------
     Eventos
     ---------------------------------------------------------------------- */

  function bindEvents() {
    document.addEventListener("keydown", onKeyDown);

    // que los botones no se queden con el foco (rompería el espacio)
    document.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (button) button.blur();
    });

    ui.brand.addEventListener("click", newTest);
    ui.btnAgain.addEventListener("click", newTest);
    ui.btnChangeLetters.addEventListener("click", () => {
      newTest();
      openPanel();
    });
    ui.btnEmptyFix.addEventListener("click", openPanel);

    ui.btnLetters.addEventListener("click", togglePanel);
    ui.cfgLetters.addEventListener("click", togglePanel);
    ui.btnClosePanel.addEventListener("click", closePanel);

    ui.cfgPunct.addEventListener("click", () => {
      settings.punctuation = !settings.punctuation;
      saveSettings();
      syncUI();
      newTest();
    });

    ui.cfgAccents.addEventListener("click", () => {
      settings.accents = !settings.accents;
      saveSettings();
      syncUI();
      newTest();
    });

    ui.cfgBlock.addEventListener("click", () => {
      settings.blockErrors = !settings.blockErrors;
      saveSettings();
      syncUI();
      newTest();
    });

    for (const btn of ui.config.querySelectorAll("[data-mode]")) {
      btn.addEventListener("click", () => setMode(btn.dataset.mode));
    }

    for (const btn of ui.moduleSeg.querySelectorAll("[data-module]")) {
      btn.addEventListener("click", () => {
        settings.module = btn.dataset.module;
        saveSettings();
        syncUI();
        newTest();
      });
    }

    ui.btnResetStats.addEventListener("click", () => {
      if (!confirm("¿Borrar el historial de fallos de todas las letras?")) return;
      for (const c of ALPHABET) letterStats[c] = { n: 0, e: 0 };
      pairStats = {};
      saveLetterStats();
      paintMiniKeys();
      scheduleNewTest();
    });

    ui.btnFingers.addEventListener("click", () => {
      settings.fingers = !settings.fingers;
      saveSettings();
      syncUI();
      updateCaret();
    });

    ui.btnHistory.addEventListener("click", openHistory);
    ui.btnCloseHistory.addEventListener("click", closeHistory);
    ui.btnClearHistory.addEventListener("click", () => {
      if (!confirm("¿Borrar el historial de pruebas y los récords?")) return;
      writeJSON(HISTORY_KEY, []);
      writeJSON(BEST_KEY, {});
      renderHistory();
    });

    window.addEventListener("pagehide", saveLetterStats);

    for (const btn of ui.amountTime.querySelectorAll("[data-time]")) {
      btn.addEventListener("click", () => {
        settings.time = Number(btn.dataset.time);
        saveSettings();
        syncUI();
        newTest();
      });
    }

    for (const btn of ui.amountWords.querySelectorAll("[data-count]")) {
      btn.addEventListener("click", () => {
        settings.count = Number(btn.dataset.count);
        saveSettings();
        syncUI();
        newTest();
      });
    }

    for (const btn of ui.filterSeg.querySelectorAll("[data-filter]")) {
      btn.addEventListener("click", () => setFilter(btn.dataset.filter));
    }

    for (const btn of ui.typeSeg.querySelectorAll("[data-type]")) {
      btn.addEventListener("click", () => setType(btn.dataset.type));
    }

    for (const btn of ui.presets.querySelectorAll("[data-preset]")) {
      btn.addEventListener("click", () => applyPreset(btn.dataset.preset));
    }

    ui.vowelsToggle.addEventListener("change", () => {
      settings.vowels = ui.vowelsToggle.checked;
      saveSettings();
      syncUI();
      scheduleNewTest();
    });

    ui.blockToggle.addEventListener("change", () => {
      settings.blockErrors = ui.blockToggle.checked;
      saveSettings();
      syncUI();
      scheduleNewTest();
    });

    ui.btnSound.addEventListener("click", () => {
      settings.sound = !settings.sound;
      saveSettings();
      syncUI();
      if (settings.sound) playClick(true);
    });

    ui.btnTheme.addEventListener("click", () => {
      const index = THEMES.indexOf(settings.theme);
      settings.theme = THEMES[(index + 1) % THEMES.length];
      applyTheme();
      saveSettings();
      if (!ui.results.hidden && S.lastResults) drawChart(S.lastResults.samples);
      if (!ui.history.hidden) renderHistory();
    });

    window.addEventListener("resize", () => {
      measure();
      updateCaret();
      if (!ui.results.hidden && S.lastResults) drawChart(S.lastResults.samples);
      if (!ui.history.hidden) renderHistory();
    });

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        measure();
        updateCaret();
      });
    }
  }

  function applyTheme() {
    document.body.dataset.theme = settings.theme;
    const colors = {
      serika: "#323437",
      dracula: "#282a36",
      nord: "#2e3440",
      paper: "#e9e6de",
    };
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", colors[settings.theme] || "#323437");
  }

  /* ----------------------------------------------------------------------
     Arranque
     ---------------------------------------------------------------------- */

  function init() {
    applyTheme();
    buildKeyboard();
    buildMiniKeyboard();
    bindEvents();
    syncUI();
    newTest();
  }

  init();
})();
