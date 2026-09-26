const {
  units: middleUnits,
  words: manualWords,
  dailyPlan,
  focusSounds,
} = window.APP_DATA;
const fullEntries = window.FULL_LEXICON?.entries || [];
const primaryPayload = window.PRIMARY_LEXICON || { units: [], entries: [] };
const primaryUnits = primaryPayload.units || [];
const primaryEntries = primaryPayload.entries || [];
const units = [...middleUnits, ...primaryUnits];
const unitMap = new Map(units.map((unit) => [unit.key, unit]));

const TERM_META = [
  {
    key: "7A",
    label: "七上",
    title: "七年级上册",
    color: "#216b78",
    soft: "#e5f2f4",
    icon: "graduation-cap",
  },
  {
    key: "7B",
    label: "七下",
    title: "七年级下册",
    color: "#267257",
    soft: "#e7f3ec",
    icon: "sprout",
  },
  {
    key: "8A",
    label: "八上",
    title: "八年级上册",
    color: "#c6543b",
    soft: "#fbece8",
    icon: "flask-conical",
  },
  {
    key: "8B",
    label: "八下",
    title: "八年级下册",
    color: "#a66b16",
    soft: "#fbf1dc",
    icon: "map",
  },
  {
    key: "9A",
    label: "九上",
    title: "九年级上册",
    color: "#545b9b",
    soft: "#ececf7",
    icon: "brain",
  },
  {
    key: "9B",
    label: "九下",
    title: "九年级下册",
    color: "#8b4b63",
    soft: "#f6e9ee",
    icon: "compass",
  },
];
const PRIMARY_TERM_COLORS = [
  ["#2f7183", "#e4f1f4", "backpack"],
  ["#267257", "#e7f3ec", "apple"],
  ["#c6543b", "#fbece8", "pencil-ruler"],
  ["#a66b16", "#fbf1dc", "puzzle"],
  ["#545b9b", "#ececf7", "book-open"],
  ["#8b4b63", "#f6e9ee", "stars"],
  ["#47702c", "#edf3e7", "sprout"],
  ["#216b78", "#e5f2f4", "graduation-cap"],
];
const primaryTermMap = new Map();
primaryUnits.forEach((unit) => {
  if (primaryTermMap.has(unit.termKey)) return;
  const index = primaryTermMap.size;
  const [color, soft, icon] = PRIMARY_TERM_COLORS[index % PRIMARY_TERM_COLORS.length];
  primaryTermMap.set(unit.termKey, {
    key: unit.termKey,
    label: unit.termLabel,
    title: `${unit.grade}${unit.term}`,
    color,
    soft,
    icon,
    level: "primary",
  });
});
const PRIMARY_TERM_META = [...primaryTermMap.values()];
const termMap = new Map(
  [...TERM_META, ...PRIMARY_TERM_META].map((term) => [term.key, term]),
);

function normalizeTermKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, "");
}

const allEntries = [];
const seenEntries = new Set();

function hydrateEntries(entries, level) {
  entries.forEach((entry) => {
    const unit = unitMap.get(entry.unitKey);
    const uniqueKey = `${entry.unitKey}|${normalizeTermKey(entry.word || entry.text)}`;
    if (!entry.word || seenEntries.has(uniqueKey)) return;
    seenEntries.add(uniqueKey);
    allEntries.push({
      ...entry,
      level,
      grade: entry.grade || unit?.grade || "",
      termKey: entry.termKey || unit?.termKey || "",
      termLabel: entry.termLabel || unit?.termLabel || "",
      unitNo: entry.unitNo || unit?.unit || 0,
      unitTitle: entry.unitTitle || unit?.title || "",
      unitTitleZh: entry.unitTitleZh || unit?.titleZh || "",
      unitLabel:
        entry.unitLabel ||
        (unit ? `${unit.term} Unit ${unit.unit} · ${unit.title}` : ""),
    });
  });
}

hydrateEntries(manualWords, "middle");
hydrateEntries(fullEntries, "middle");
hydrateEntries(primaryEntries, "primary");

const words = allEntries.filter((entry) => !entry.isPhrase);
const phrases = allEntries.filter((entry) => entry.isPhrase);
const wordMap = new Map(allEntries.map((word) => [word.id, word]));
const STORAGE_KEY = "yuexueci-progress-v1";
const DAILY_GOAL = dailyPlan.length;

const DEFAULT_STATE = {
  view: "home",
  learned: [],
  mastery: {},
  days: {},
  streak: 0,
  lastStudyDate: null,
  pronunciation: {
    attempts: 0,
    totalScore: 0,
    byWord: {},
  },
  quiz: {
    correct: 0,
    total: 0,
    lastScore: null,
    lastWrong: [],
  },
  level: "middle",
  termKey: "7A",
  unitKey: "全部",
  grade: "全部",
  topic: "全部",
  search: "",
  accent: "UK",
  settings: {
    autoPlay: false,
    slowFirst: true,
    showTranslation: true,
  },
  quizSession: null,
};

const app = document.querySelector("#app");
const topbar = document.querySelector("#topbar");
const wordSheet = document.querySelector("#wordSheet");
const sheetScrim = document.querySelector("#sheetScrim");
const toastElement = document.querySelector("#toast");

let state = loadState();
let toastTimer = null;
let sheetCloseTimer = null;
let activeUtterance = null;
let speechToken = 0;

let mediaRecorder = null;
let mediaStream = null;
let recordedChunks = [];
let speechRecognition = null;
let recordTimer = null;
let recordAutoStop = null;
let recordStartedAt = 0;
let lastTranscript = "";
let lastFinalTranscript = "";
let lastInterimTranscript = "";

let recording = {
  isRecording: false,
  requesting: false,
  finalized: false,
  blobUrl: "",
  duration: 0,
  transcript: "",
  score: null,
  error: "",
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved) {
      return cloneDefaultState();
    }

    const nextState = {
      ...cloneDefaultState(),
      ...saved,
      pronunciation: {
        ...cloneDefaultState().pronunciation,
        ...(saved.pronunciation || {}),
      },
      quiz: {
        ...cloneDefaultState().quiz,
        ...(saved.quiz || {}),
      },
      settings: {
        ...cloneDefaultState().settings,
        ...(saved.settings || {}),
      },
    };
    if (!["middle", "primary"].includes(nextState.level)) nextState.level = "middle";
    const validTerms = nextState.level === "primary" ? PRIMARY_TERM_META : TERM_META;
    if (!validTerms.some((term) => term.key === nextState.termKey)) {
      nextState.termKey = validTerms[0]?.key || "7A";
    }
    if (nextState.unitKey !== "全部" && !unitMap.has(nextState.unitKey)) {
      nextState.unitKey = "全部";
    }
    nextState.grade = "全部";
    nextState.topic = "全部";
    return nextState;
  } catch (error) {
    return cloneDefaultState();
  }
}

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    // The app still works when storage is blocked; progress simply will not persist.
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function icon(name) {
  return `<i data-lucide="${name}" aria-hidden="true"></i>`;
}

function renderIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayOffsetKey(offset) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return todayKey(date);
}

function getTodayCount() {
  return Number(state.days[todayKey()] || 0);
}

function getLearnedSet() {
  return new Set(state.learned);
}

function getCompletedDailyCount() {
  const learned = getLearnedSet();
  return dailyPlan.filter((id) => learned.has(id)).length;
}

function getMasteredCount() {
  return words.filter((word) => Number(state.mastery[word.id] || 0) >= 2).length;
}

function getPronunciationAverage() {
  if (!state.pronunciation.attempts) {
    return null;
  }
  return Math.round(state.pronunciation.totalScore / state.pronunciation.attempts);
}

function getQuizAccuracy() {
  if (!state.quiz.total) {
    return null;
  }
  return Math.round((state.quiz.correct / state.quiz.total) * 100);
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了";
  if (hour < 12) return "早上好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

function formatSeconds(seconds) {
  return `${Number(seconds || 0).toFixed(1)}s`;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

function levenshtein(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + substitutionCost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[b.length];
}

function pronunciationScore(expected, heard) {
  const target = normalizeText(expected);
  const transcript = normalizeText(heard);

  if (!target || !transcript) {
    return null;
  }

  if (transcript.includes(target)) {
    return 100;
  }

  const distance = levenshtein(target, transcript);
  const similarity = 1 - distance / Math.max(target.length, transcript.length);
  return Math.max(0, Math.min(99, Math.round(similarity * 100)));
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }
  return copy;
}

function touchStudy(amount = 1) {
  const today = todayKey();
  state.days[today] = Number(state.days[today] || 0) + amount;

  if (state.lastStudyDate !== today) {
    state.streak = state.lastStudyDate === dayOffsetKey(-1) ? Number(state.streak || 0) + 1 : 1;
    state.lastStudyDate = today;
  }

  saveState();
}

function markWordLearned(id, increment = 1) {
  const firstTime = !state.learned.includes(id);
  if (firstTime) {
    state.learned.push(id);
  }

  state.mastery[id] = Math.min(3, Number(state.mastery[id] || 0) + increment);
  if (firstTime) {
    touchStudy(1);
  } else {
    saveState();
  }
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toastElement.textContent = message;
  toastElement.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    toastElement.classList.remove("is-visible");
  }, 2600);
}

function renderTopbar() {
  topbar.innerHTML = `
    <div class="brand">
      <span class="brand-mark">粤</span>
      <div class="brand-copy">
        <span class="brand-title">粤学词</span>
        <span class="brand-subtitle">小学广州版 · 初中沪教牛津版</span>
      </div>
    </div>
    <button class="topbar-progress" type="button" data-action="go-profile" title="查看学习记录">
      ${icon("flame")}
      <span>${Number(state.streak || 0)} 天</span>
    </button>
  `;
}

function syncTabs() {
  document.querySelectorAll(".tab-item").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === state.view);
  });
}

function setView(view) {
  stopSpeech();
  state.view = view;
  state.quizSession = view === "practice" ? state.quizSession : null;
  saveState();
  render();
  document.querySelector(".app-main").scrollTop = 0;
}

function render() {
  renderTopbar();
  syncTabs();

  if (state.view === "library") {
    app.innerHTML = renderLibrary();
    renderLibraryList();
  } else if (state.view === "speaking") {
    app.innerHTML = renderSpeaking();
  } else if (state.view === "practice") {
    app.innerHTML = renderPractice();
  } else if (state.view === "profile") {
    app.innerHTML = renderProfile();
  } else {
    state.view = "home";
    app.innerHTML = renderHome();
  }

  renderIcons();
}

function renderHome() {
  const learned = getLearnedSet();
  const completed = getCompletedDailyCount();
  const progressDegrees = Math.round((completed / DAILY_GOAL) * 360);
  const nextWordId = dailyPlan.find((id) => !learned.has(id)) || dailyPlan[0];
  const nextWord = wordMap.get(nextWordId);
  const pronunciationAverage = getPronunciationAverage();

  return `
    <div class="page">
      <section class="daily-hero">
        <div class="daily-hero-copy">
          <span class="daily-kicker">${icon("book-open-check")} 今日计划 · 沪教牛津版</span>
          <h1>${completed === DAILY_GOAL ? "今日任务已完成" : "跟读今天的 8 个单词"}</h1>
          <p>${
            completed === DAILY_GOAL
              ? "再复习一轮，发音会更稳。"
              : "先听音标，再模仿节奏。每读完一个词，难度都会下降一点。"
          }</p>
          <button
            class="primary-button hero-cta"
            type="button"
            data-action="continue-daily"
            data-word="${nextWord.id}"
          >
            ${icon(completed === DAILY_GOAL ? "rotate-ccw" : "play")}
            ${completed === DAILY_GOAL ? "复习第一词" : `继续 · ${escapeHtml(nextWord.word)}`}
          </button>
        </div>
        <div class="progress-ring" style="--progress: ${progressDegrees}deg" aria-label="今日完成进度">
          <div class="progress-ring-copy">
            <strong>${completed}/${DAILY_GOAL}</strong>
            <span>今日单词</span>
          </div>
        </div>
      </section>

      <section class="stats-strip" aria-label="学习概览">
        <div class="stat-item">
          <strong>${getTodayCount()}</strong>
          <span>今日学习</span>
        </div>
        <div class="stat-item">
          <strong>${state.pronunciation.attempts}</strong>
          <span>跟读次数</span>
        </div>
        <div class="stat-item">
          <strong>${pronunciationAverage === null ? "--" : pronunciationAverage}</strong>
          <span>跟读均分</span>
        </div>
      </section>

      <section class="section">
        <div class="home-follow-card">
          <div class="home-follow-head">
            <div>
              <span class="eyebrow">${icon("audio-lines")} 首页音标跟读</span>
              <h2>看着音标，马上读一遍</h2>
            </div>
            <span class="home-follow-unit">${escapeHtml(nextWord.termLabel)} · Unit ${nextWord.unitNo}</span>
          </div>
          <div class="home-follow-word">
            <div>
              <strong>${escapeHtml(nextWord.word)}</strong>
              <span>${escapeHtml(state.accent === "UK" ? nextWord.ipaUK : nextWord.ipaUS)}</span>
            </div>
            <button
              class="sound-button"
              type="button"
              data-action="speak-word"
              data-word="${nextWord.id}"
              title="播放 ${escapeHtml(nextWord.word)} 的发音"
            >
              ${icon("volume-2")}
            </button>
          </div>
          <div class="home-follow-syllables">
            ${nextWord.syllables
              .split("·")
              .map((part) => `<span>${escapeHtml(part)}</span>`)
              .join("<i></i>")}
          </div>
          <div class="home-follow-actions">
            <button class="ghost-button" type="button" data-action="speak-slow" data-word="${nextWord.id}">
              ${icon("snail")} 慢速示范
            </button>
            <button class="primary-button" type="button" data-action="home-follow" data-word="${nextWord.id}">
              ${icon("mic")} 开始跟读
            </button>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section-heading">
          <div>
            <h2>按教材册别学习</h2>
            <p>沪教牛津版 · 初一到初三全部 Unit</p>
          </div>
        </div>
        <div class="topic-scroller">
          ${TERM_META
            .map((term) => {
              const termUnits = units.filter((unit) => unit.termKey === term.key);
              const count = words.filter((word) => word.termKey === term.key).length;
              return `
                <button
                  class="topic-tile"
                  type="button"
                  data-action="select-term"
                  data-term="${term.key}"
                  style="--topic-color:${term.color};--topic-soft:${term.soft}"
                >
                  <span class="topic-tile-icon">${icon(term.icon)}</span>
                  <span>
                    <strong>${escapeHtml(term.label)}</strong>
                    <span>${termUnits.length} 个 Unit · ${count} 个核心词</span>
                  </span>
                </button>
              `;
            })
            .join("")}
        </div>
        <button
          class="primary-entry-card"
          type="button"
          data-action="select-level"
          data-level="primary"
        >
          <span class="primary-entry-icon">${icon("backpack")}</span>
          <span>
            <strong>小学衔接词库 · 广州版</strong>
            <small>三至六年级完整词表 · 小升初衔接</small>
          </span>
          ${icon("arrow-right")}
        </button>
      </section>

      <section class="section">
        <div class="section-heading">
          <div>
            <h2>今日词单</h2>
            <p>听、读、记，每词约 40 秒</p>
          </div>
          <button class="text-button" type="button" data-action="go-speaking">
            专项跟读 ${icon("arrow-right")}
          </button>
        </div>
        <div class="word-list">
          ${dailyPlan.map((id) => renderWordRow(wordMap.get(id), learned.has(id))).join("")}
        </div>
      </section>
    </div>
  `;
}

function renderWordRow(word, isLearned, options = {}) {
  return `
    <div
      class="word-row ${isLearned ? "is-learned" : ""}"
      role="button"
      tabindex="0"
      data-action="open-word"
      data-word="${word.id}"
      aria-label="学习单词 ${escapeHtml(word.word)}"
    >
      <div class="word-main">
        <div class="word-title-line">
          <strong>${escapeHtml(word.word)}</strong>
          ${
            word.isPhrase
              ? '<em class="phrase-badge">短语</em>'
              : options.showUnit
                ? `<em>${escapeHtml(word.termLabel)} U${word.unitNo}</em>`
                : ""
          }
        </div>
        <span class="word-ipa">${escapeHtml(state.accent === "UK" ? word.ipaUK : word.ipaUS)}</span>
        <span class="word-meaning">${escapeHtml(word.meaning)}</span>
        <span class="word-example-preview">${escapeHtml(word.example || "")}</span>
      </div>
      ${
        isLearned
          ? `<span class="learned-mark" title="已学习">${icon("check")}</span>`
          : `<span class="word-chevron">${icon("chevron-right")}</span>`
      }
      <button
        class="sound-button"
        type="button"
        data-action="speak-word"
        data-word="${word.id}"
        title="播放 ${escapeHtml(word.word)} 的发音"
        aria-label="播放 ${escapeHtml(word.word)} 的发音"
      >
        ${icon("volume-2")}
      </button>
    </div>
  `;
}

function renderSpeaking() {
  const learned = getLearnedSet();
  const followWords = dailyPlan.map((id) => wordMap.get(id)).slice(0, 6);
  const average = getPronunciationAverage();

  return `
    <div class="page">
      <section class="speaking-hero">
        <h1>把音标读准，单词才不会“听得出、说不出”</h1>
        <p>选择英音或美音，先听示范，再录下自己的声音。系统支持时会自动识别并给出跟读分数。</p>
        <button class="primary-button" type="button" data-action="open-word" data-word="${followWords[0].id}">
          ${icon("mic")} 开始跟读
        </button>
      </section>

      <section class="section">
        <div class="section-heading">
          <div>
            <h2>重点音素</h2>
            <p>广州学生常见的易混发音</p>
          </div>
          <span class="word-ipa">${
            average === null ? "暂无数据" : `均分 ${average}`
          }</span>
        </div>
        <div class="sound-grid">
          ${focusSounds
            .map(
              (sound, index) => `
                <article class="sound-card">
                  <div class="sound-card-top">
                    <span class="sound-ipa">${escapeHtml(sound.ipa)}</span>
                    <button
                      class="sound-play"
                      type="button"
                      data-action="speak-focus"
                      data-sound-index="${index}"
                      title="播放 ${escapeHtml(sound.label)} 示例"
                    >
                      ${icon("play")}
                    </button>
                  </div>
                  <strong>${escapeHtml(sound.label)}</strong>
                  <p>${escapeHtml(sound.hint)}</p>
                  <span class="contrast-pill">对比 ${escapeHtml(sound.contrast)} · ${escapeHtml(sound.contrastHint)}</span>
                  <div class="focus-word-list">
                    ${sound.words
                      .map(
                        (id) => `
                          <button
                            class="focus-word"
                            type="button"
                            data-action="open-word"
                            data-word="${id}"
                          >
                            ${escapeHtml(wordMap.get(id).word)}
                          </button>
                        `,
                      )
                      .join("")}
                  </div>
                </article>
              `,
            )
            .join("")}
        </div>
      </section>

      <section class="section">
        <div class="section-heading">
          <div>
            <h2>跟读练习</h2>
            <p>${state.pronunciation.attempts} 次录音 · ${
              average === null ? "等待首次评分" : `平均 ${average} 分`
            }</p>
          </div>
        </div>
        <div class="word-list">
          ${followWords.map((word) => renderWordRow(word, learned.has(word.id))).join("")}
        </div>
      </section>
    </div>
  `;
}

function renderLibrary() {
  const terms = [{ key: "全部", label: "全部" }, ...getActiveTerms()];
  return `
    <div class="page">
      <div class="library-toolbar">
        <div class="level-switch" aria-label="选择词库阶段">
          <button
            class="level-switch-button ${state.level === "primary" ? "is-active" : ""}"
            type="button"
            data-action="select-level"
            data-level="primary"
          >
            小学 · 广州版
          </button>
          <button
            class="level-switch-button ${state.level === "middle" ? "is-active" : ""}"
            type="button"
            data-action="select-level"
            data-level="middle"
          >
            初中 · 沪教牛津版
          </button>
        </div>
        <div class="search-box">
          ${icon("search")}
            <input
              id="wordSearch"
              type="search"
              value="${escapeHtml(state.search)}"
              placeholder="搜索单词、音标、中文或 Unit"
              autocomplete="off"
              aria-label="搜索单词"
          />
          ${
            state.search
              ? `<button class="search-clear" type="button" data-action="clear-search" title="清空搜索">${icon("x")}</button>`
              : ""
          }
        </div>
        <div class="filter-row" aria-label="按教材册别筛选">
          ${terms
            .map(
              (term) => `
                <button
                  class="filter-chip ${state.termKey === term.key ? "is-active" : ""}"
                  type="button"
                  data-action="select-term"
                  data-term="${term.key}"
                >
                  ${escapeHtml(term.label)}
                </button>
              `,
            )
            .join("")}
        </div>
      </div>
      <div id="libraryList"></div>
    </div>
  `;
}

function getActiveTerms() {
  return state.level === "primary" ? PRIMARY_TERM_META : TERM_META;
}

function getActiveUnits() {
  return units.filter((unit) =>
    state.level === "primary" ? unit.level === "primary" : unit.level !== "primary",
  );
}

function getDisplayUnitTitle(unit) {
  return state.level === "primary"
    ? unit.title.replace(/^Unit\s*\d+\s*·?\s*/i, "")
    : unit.title;
}

function getFilteredWords() {
  const query = normalizeSearch(state.search);
  return allEntries.filter((word) => {
    const levelMatches =
      state.level === "primary" ? word.level === "primary" : word.level !== "primary";
    const termMatches =
      Boolean(query) || state.termKey === "全部" || word.termKey === state.termKey;
    const unitMatches =
      Boolean(query) || state.unitKey === "全部" || word.unitKey === state.unitKey;
    const haystack = normalizeSearch(
      `${word.word} ${word.ipaUK} ${word.ipaUS} ${word.meaning} ${word.example} ${word.termLabel} Unit ${word.unitNo} ${word.unitTitle} ${word.unitTitleZh}`,
    );
    const searchMatches = !query || haystack.includes(query);
    return levelMatches && termMatches && unitMatches && searchMatches;
  });
}

function renderLibraryList() {
  const container = document.querySelector("#libraryList");
  if (!container) return;

  const filtered = getFilteredWords();
  const learned = getLearnedSet();
  const activeTerm = state.termKey === "全部" ? null : termMap.get(state.termKey);
  const activeUnit = state.unitKey === "全部" ? null : unitMap.get(state.unitKey);
  const hasSearch = Boolean(normalizeSearch(state.search));
  const activeUnits = getActiveUnits();
  const visibleUnits = activeUnits
    .filter(
      (unit) =>
        hasSearch || state.termKey === "全部" || unit.termKey === state.termKey,
    )
    .filter(
      (unit) => hasSearch || state.unitKey === "全部" || unit.key === state.unitKey,
    );
  const groupedUnits = visibleUnits
    .map((unit) => ({
      unit,
      items: filtered.filter((word) => word.unitKey === unit.key),
    }))
    .filter((group) => group.items.length);

  if (!filtered.length) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-state-icon">${icon("search-x")}</span>
        <h2>没有找到匹配单词</h2>
        <p>试试更短的关键词，或切换阶段、册别和 Unit。</p>
        <button class="ghost-button" type="button" data-action="clear-filters">
          ${icon("rotate-ccw")} 清除筛选
        </button>
      </div>
    `;
    renderIcons();
    return;
  }

  container.innerHTML = `
    <div class="library-summary">
      ${
        activeTerm
          ? `<button class="filter-chip is-active" type="button" data-action="select-term" data-term="全部">${escapeHtml(
              activeTerm.label,
            )} ×</button> `
          : ""
      }
      ${
        activeUnit
          ? `<button class="filter-chip is-active" type="button" data-action="clear-unit">Unit ${activeUnit.unit} ×</button> `
          : ""
      }
      ${
        state.level === "primary" ? "广州版小学词库 · " : "沪教牛津版初中词库 · "
      }
      找到 <strong>${filtered.length}</strong> 个词条
    </div>
    ${!hasSearch && !activeUnit ? renderUnitBrowser() : ""}
    ${groupedUnits
      .map(
        ({ unit, items }) => `
          <section class="topic-group">
            <div class="topic-group-head">
              <span class="topic-group-icon" style="--topic-color:${
                termMap.get(unit.termKey)?.color || "#267257"
              }">${icon("book-open")}</span>
              <strong>Unit ${unit.unit} · ${escapeHtml(getDisplayUnitTitle(unit))}</strong>
              <span>${unit.grade}${unit.term} · ${items.length} 词条</span>
            </div>
            ${
              unit.titleZh && unit.titleZh !== unit.title
                ? `<p class="unit-group-zh">${escapeHtml(unit.titleZh)}</p>`
                : ""
            }
            <div class="word-list">
              ${items
                .filter((item) => !item.isPhrase)
                .map((word) => renderWordRow(word, learned.has(word.id)))
                .join("")}
            </div>
            ${
              items.some((item) => item.isPhrase)
                ? `
                  <div class="phrase-group-title">
                    <span>${icon("link-2")}</span>
                    <strong>单元短语</strong>
                    <em>${items.filter((item) => item.isPhrase).length} 条</em>
                  </div>
                  <div class="word-list phrase-list">
                    ${items
                      .filter((item) => item.isPhrase)
                      .map((word) => renderWordRow(word, learned.has(word.id)))
                      .join("")}
                  </div>
                `
                : ""
            }
          </section>
        `,
      )
      .join("")}
  `;
  renderIcons();
}

function renderUnitBrowser() {
  const visibleTerms =
    state.termKey === "全部"
      ? getActiveTerms()
      : getActiveTerms().filter((term) => term.key === state.termKey);
  const activeUnits = getActiveUnits();

  return `
    <section class="unit-browser">
      <div class="unit-browser-title">
        <div>
          <strong>${
            state.level === "primary" ? "广州版英语 · 全部 Unit" : "沪教牛津版 · 全部 Unit"
          }</strong>
          <span>${
            state.level === "primary"
              ? "广州版小学英语 · 三至六年级"
              : "初一到初三，按教材顺序选择"
          }</span>
        </div>
        <span>${activeUnits.length} Unit</span>
      </div>
      ${visibleTerms
        .map((term) => {
          const termUnits = activeUnits.filter((unit) => unit.termKey === term.key);
          return `
            <section class="term-group">
              <div class="term-group-head">
                <span style="background:${term.color}">${escapeHtml(term.label)}</span>
                <strong>${escapeHtml(term.title)}</strong>
                <em>${termUnits.length} Unit</em>
              </div>
              <div class="unit-card-grid">
                ${termUnits
                  .map((unit) => {
                    const count = allEntries.filter((word) => word.unitKey === unit.key).length;
                    return `
                      <button
                        class="unit-card ${state.unitKey === unit.key ? "is-active" : ""}"
                        type="button"
                        data-action="select-unit"
                        data-unit="${unit.key}"
                      >
                        <span class="unit-card-no">Unit ${unit.unit}</span>
                        <strong>${escapeHtml(getDisplayUnitTitle(unit))}</strong>
                        <span>${escapeHtml(unit.titleZh)} · ${count} 词</span>
                      </button>
                    `;
                  })
                  .join("")}
              </div>
            </section>
          `;
        })
        .join("")}
    </section>
  `;
}

function renderPractice() {
  if (state.quizSession) {
    if (state.quizSession.finished) {
      return renderQuizResult();
    }
    return renderQuizQuestion();
  }

  const accuracy = getQuizAccuracy();
  const wrongCount = state.quiz.lastWrong.length;

  return `
    <div class="page">
      <section class="practice-hero">
        <div>
          <strong>今日闯关</strong>
          <p>听音辨词、音标配对、词义理解，三种方式交叉复习。</p>
        </div>
        <div class="accuracy-badge">
          <div>
            <strong>${accuracy === null ? "--" : `${accuracy}%`}</strong>
            <span>历史正确率</span>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section-heading">
          <div>
            <h2>选择练习模式</h2>
            <p>每组 8 题，约 3 分钟</p>
          </div>
        </div>
        <div class="practice-stack">
          <button class="mode-card" type="button" data-action="start-quiz" data-mode="meaning">
            <span class="mode-icon" style="--mode-color:#267257">${icon("book-open-check")}</span>
            <span class="mode-copy">
              <strong>看词选义</strong>
              <span>看到英文和音标，选择正确的中文含义</span>
            </span>
            ${icon("chevron-right")}
          </button>
          <button class="mode-card" type="button" data-action="start-quiz" data-mode="listen">
            <span class="mode-icon" style="--mode-color:#2f7183">${icon("headphones")}</span>
            <span class="mode-copy">
              <strong>听音选词</strong>
              <span>只听发音，从四个单词中迅速辨认</span>
            </span>
            ${icon("chevron-right")}
          </button>
          <button class="mode-card" type="button" data-action="start-quiz" data-mode="ipa">
            <span class="mode-icon" style="--mode-color:#a66b16">${icon("braces")}</span>
            <span class="mode-copy">
              <strong>音标配对</strong>
              <span>根据音标线索，选出对应单词</span>
            </span>
            ${icon("chevron-right")}
          </button>
          <button class="mode-card" type="button" data-action="start-quiz" data-mode="wrong">
            <span class="mode-icon" style="--mode-color:#c6543b">${icon("notebook-tabs")}</span>
            <span class="mode-copy">
              <strong>错题重练</strong>
              <span>${wrongCount ? `当前有 ${wrongCount} 个单词等待复习` : "暂无错题，先完成一组练习"}</span>
            </span>
            ${icon("chevron-right")}
          </button>
        </div>
      </section>

      <section class="section">
        <div class="section-heading">
          <div>
            <h2>练习建议</h2>
            <p>先跟读，再做听辨，记忆会更牢</p>
          </div>
        </div>
        <div class="tip-block">
          ${icon("lightbulb")}
          <div>
            <strong>先听音，再看字母</strong>
            <p>听到不熟的词时，不要马上猜。先回想音标和重音位置，再看选项。</p>
          </div>
        </div>
      </section>
    </div>
  `;
}

function createQuizSession(mode) {
  let sourceIds = [];
  if (mode === "wrong") {
    sourceIds = [...state.quiz.lastWrong].filter((id) => wordMap.has(id));
    if (!sourceIds.length) {
      showToast("还没有错题，先完成一组练习吧。");
      return;
    }
  } else {
    sourceIds =
      state.level === "primary"
        ? words.filter((word) => word.level === "primary").slice(0, 40).map((word) => word.id)
        : dailyPlan.filter((id) => wordMap.has(id));
  }

  const sourceSet = new Set(sourceIds);
  const filler = shuffle(words.map((word) => word.id).filter((id) => !sourceSet.has(id)));
  const selectedIds = shuffle(sourceIds).slice(0, 8);

  while (selectedIds.length < 8 && filler.length) {
    selectedIds.push(filler.shift());
  }

  const questions = selectedIds.map((id) => {
    const correctWord = wordMap.get(id);
    const distractors = shuffle(words.filter((word) => word.id !== id)).slice(0, 3);
    const options = shuffle([correctWord, ...distractors]).map((word) => word.id);
    return {
      wordId: id,
      options,
    };
  });

  state.quizSession = {
    mode,
    questions,
    index: 0,
    selected: null,
    correctCount: 0,
    finished: false,
    wrongIds: [],
    score: 0,
  };

  render();
  if (mode === "listen") {
    window.setTimeout(() => {
      speakText(wordMap.get(questions[0].wordId).word, { rate: 0.9 });
    }, 350);
  }
}

function renderQuizQuestion() {
  const session = state.quizSession;
  const question = session.questions[session.index];
  const word = wordMap.get(question.wordId);
  const answered = session.selected !== null;
  const selectedIsCorrect = session.selected === word.id;
  const progress = ((session.index + (answered ? 1 : 0)) / session.questions.length) * 100;

  let prompt = "";
  if (session.mode === "listen") {
    prompt = `
      <span class="eyebrow">${icon("headphones")} 听音选词</span>
      <button
        class="quiz-audio-button"
        type="button"
        data-action="repeat-quiz-audio"
        data-word="${word.id}"
        title="重新播放发音"
      >
        ${icon("volume-2")}
      </button>
      <p class="quiz-ipa">点击播放，选出你听到的单词</p>
    `;
  } else if (session.mode === "ipa") {
    prompt = `
      <span class="eyebrow">${icon("braces")} 音标配对</span>
      <p class="quiz-ipa">${escapeHtml(state.accent === "UK" ? word.ipaUK : word.ipaUS)}</p>
      <p class="quiz-subprompt">哪个单词对应这个音标？</p>
    `;
  } else {
    prompt = `
      <span class="eyebrow">${icon("book-open-check")} 看词选义</span>
      <h1 class="quiz-word">${escapeHtml(word.word)}</h1>
      <p class="quiz-ipa">${escapeHtml(state.accent === "UK" ? word.ipaUK : word.ipaUS)}</p>
    `;
  }

  const optionLabels =
    session.mode === "meaning"
      ? question.options.map((id) => wordMap.get(id).meaning)
      : question.options.map((id) => wordMap.get(id).word);

  return `
    <div class="page quiz-wrap">
      <div class="quiz-topline">
        <strong>${session.index + 1} / ${session.questions.length}</strong>
        <span>已答对 ${session.correctCount} 题</span>
        <button class="text-button" type="button" data-action="exit-quiz">${icon("x")} 退出</button>
      </div>
      <div class="progress-bar"><span style="width:${progress}%"></span></div>

      <section class="quiz-question">${prompt}</section>

      <div class="option-list">
        ${question.options
          .map((id, index) => {
            let className = "option-button";
            if (answered && id === word.id) className += " is-correct";
            if (answered && id === session.selected && id !== word.id) className += " is-wrong";
            return `
              <button
                class="${className}"
                type="button"
                data-action="answer-option"
                data-option="${id}"
                ${answered ? "disabled" : ""}
              >
                <span class="option-key">${String.fromCharCode(65 + index)}</span>
                <span>${escapeHtml(optionLabels[index])}</span>
              </button>
            `;
          })
          .join("")}
      </div>

      ${
        answered
          ? `
            <div class="quiz-feedback">
              <strong>${selectedIsCorrect ? "答对了" : `正确答案：${escapeHtml(word.word)}`}</strong>
              <p>${escapeHtml(word.meaning)} · ${escapeHtml(
                state.accent === "UK" ? word.ipaUK : word.ipaUS,
              )}<br />${escapeHtml(word.tip)}</p>
            </div>
            <div class="quiz-actions">
              <button class="primary-button" type="button" data-action="next-question">
                ${session.index === session.questions.length - 1 ? "查看结果" : "下一题"}
                ${icon("arrow-right")}
              </button>
            </div>
          `
          : ""
      }
    </div>
  `;
}

function answerQuiz(optionId) {
  const session = state.quizSession;
  if (!session || session.selected !== null) return;

  const question = session.questions[session.index];
  const word = wordMap.get(question.wordId);
  session.selected = optionId;

  const correct = optionId === word.id;
  state.quiz.total += 1;
  if (correct) {
    session.correctCount += 1;
    state.quiz.correct += 1;
    state.quiz.lastWrong = state.quiz.lastWrong.filter((id) => id !== word.id);
  } else {
    if (!session.wrongIds.includes(word.id)) session.wrongIds.push(word.id);
    if (!state.quiz.lastWrong.includes(word.id)) state.quiz.lastWrong.push(word.id);
  }

  saveState();
  render();
}

function nextQuizQuestion() {
  const session = state.quizSession;
  if (!session || session.selected === null) return;

  if (session.index >= session.questions.length - 1) {
    finishQuiz();
    return;
  }

  session.index += 1;
  session.selected = null;
  saveState();
  render();
  document.querySelector(".app-main").scrollTop = 0;

  if (session.mode === "listen") {
    const question = session.questions[session.index];
    window.setTimeout(() => {
      speakText(wordMap.get(question.wordId).word, { rate: 0.9 });
    }, 250);
  }
}

function finishQuiz() {
  const session = state.quizSession;
  if (!session) return;

  session.finished = true;
  session.score = Math.round((session.correctCount / session.questions.length) * 100);
  state.quiz.lastScore = session.score;

  session.questions.forEach((question) => {
    if (!session.wrongIds.includes(question.wordId)) {
      if (!state.learned.includes(question.wordId)) {
        state.learned.push(question.wordId);
      }
      state.mastery[question.wordId] = Math.min(
        3,
        Number(state.mastery[question.wordId] || 0) + 1,
      );
    }
  });

  touchStudy(session.questions.length);
  saveState();
  render();
  document.querySelector(".app-main").scrollTop = 0;
}

function renderQuizResult() {
  const session = state.quizSession;
  const score = session.score;
  const message =
    score >= 90
      ? "音形义掌握得很稳"
      : score >= 75
        ? "已经掌握大部分，再练一轮会更熟"
        : "先回到跟读页，把错词读准再练";

  return `
    <div class="page">
      <div class="result-score" style="--score:${score * 3.6}deg">
        <div class="result-score-inner">
          <div>
            <strong>${score}</strong>
            <span>本次得分</span>
          </div>
        </div>
      </div>
      <div class="result-copy">
        <h1>${score >= 90 ? "漂亮通关" : score >= 75 ? "完成练习" : "继续加油"}</h1>
        <p>${escapeHtml(message)}</p>
      </div>

      ${
        session.wrongIds.length
          ? `
            <section class="section">
              <div class="section-heading">
                <div>
                  <h2>本次错词</h2>
                  <p>点击单词，马上跟读复习</p>
                </div>
              </div>
              <div class="wrong-list">
                ${session.wrongIds
                  .map((id) => {
                    const word = wordMap.get(id);
                    return `
                      <div class="wrong-item">
                        <div>
                          <strong>${escapeHtml(word.word)}</strong>
                          <span>${escapeHtml(
                            state.accent === "UK" ? word.ipaUK : word.ipaUS,
                          )} · ${escapeHtml(word.meaning)}</span>
                        </div>
                        <button
                          class="sound-button"
                          type="button"
                          data-action="open-word"
                          data-word="${word.id}"
                          title="打开单词"
                        >
                          ${icon("arrow-up-right")}
                        </button>
                      </div>
                    `;
                  })
                  .join("")}
              </div>
            </section>
          `
          : ""
      }

      <div class="quiz-actions">
        <button class="primary-button" type="button" data-action="restart-quiz">
          ${icon("rotate-ccw")} 再练一组
        </button>
      </div>
      <div class="quiz-actions">
        <button class="ghost-button" type="button" data-action="exit-quiz">
          返回练习页
        </button>
      </div>
    </div>
  `;
}

function renderProfile() {
  const learnedCount = state.learned.length;
  const masteredCount = getMasteredCount();
  const pronunciationAverage = getPronunciationAverage();
  const quizAccuracy = getQuizAccuracy();
  const estimatedMinutes = Math.round(learnedCount * 1.6 + state.pronunciation.attempts * 0.7);

  return `
    <div class="page">
      <section class="profile-head">
        <div class="profile-avatar">
          学
          <span>${Number(state.streak || 0)}天</span>
        </div>
        <div class="profile-head-copy">
          <h1>${getGreeting()}，同学</h1>
          <p>已学习 ${learnedCount} 个词 · 跟读均分 ${
            pronunciationAverage === null ? "--" : pronunciationAverage
          }</p>
        </div>
      </section>

      <section class="section">
        <div class="profile-grid">
          <article class="metric-card" style="--metric-color:#267257">
            <div class="metric-card-top">${icon("book-check")}<span>累计</span></div>
            <strong>${learnedCount}</strong>
            <small>已学单词</small>
          </article>
          <article class="metric-card" style="--metric-color:#a66b16">
            <div class="metric-card-top">${icon("medal")}<span>熟练</span></div>
            <strong>${masteredCount}</strong>
            <small>掌握单词</small>
          </article>
          <article class="metric-card" style="--metric-color:#2f7183">
            <div class="metric-card-top">${icon("mic")}<span>发音</span></div>
            <strong>${state.pronunciation.attempts}</strong>
            <small>跟读次数</small>
          </article>
          <article class="metric-card" style="--metric-color:#8b4b63">
            <div class="metric-card-top">${icon("clock-3")}<span>估算</span></div>
            <strong>${estimatedMinutes}</strong>
            <small>学习分钟</small>
          </article>
        </div>
      </section>

      <section class="section">
        <div class="section-heading">
          <div>
            <h2>最近 7 天</h2>
            <p>每天学一点，比一次学很多更有效</p>
          </div>
        </div>
        <div class="week-chart" aria-label="最近七天学习词数">
          ${renderWeekChart()}
        </div>
      </section>

      <section class="section">
        <div class="section-heading">
          <div>
            <h2>发音薄弱项</h2>
            <p>完成跟读后，这里会根据识别结果更新</p>
          </div>
        </div>
        <div class="weak-sound-list">
          ${focusSounds.map((sound) => renderWeakSound(sound)).join("")}
        </div>
      </section>

      <section class="section">
        <div class="section-heading">
          <div>
            <h2>学习设置</h2>
            <p>设置会保存在当前设备</p>
          </div>
        </div>
        <div class="setting-list">
          <div class="setting-row">
            <span class="setting-icon">${icon("audio-lines")}</span>
            <span class="setting-copy">
              <strong>打开单词时自动发音</strong>
              <span>直接进入听读状态</span>
            </span>
            <button
              class="switch ${state.settings.autoPlay ? "is-on" : ""}"
              type="button"
              data-action="toggle-setting"
              data-setting="autoPlay"
              aria-label="切换自动发音"
              aria-pressed="${state.settings.autoPlay}"
            ></button>
          </div>
          <div class="setting-row">
            <span class="setting-icon">${icon("languages")}</span>
            <span class="setting-copy">
              <strong>默认口音</strong>
              <span>${state.accent === "UK" ? "英式发音" : "美式发音"}</span>
            </span>
            <button class="mini-button" type="button" data-action="toggle-accent">
              ${state.accent}
            </button>
          </div>
          <div class="setting-row">
            <span class="setting-icon">${icon("gauge")}</span>
            <span class="setting-copy">
              <strong>练习正确率</strong>
              <span>${quizAccuracy === null ? "还没有练习记录" : `${quizAccuracy}% · 共 ${
                state.quiz.total
              } 题`}</span>
            </span>
          </div>
        </div>
      </section>

      <section class="section">
        <button class="ghost-button" type="button" data-action="reset-progress">
          ${icon("trash-2")} 清空本机学习记录
        </button>
      </section>
    </div>
  `;
}

function renderWeekChart() {
  const chartData = [];
  for (let offset = -6; offset <= 0; offset += 1) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + offset);
    chartData.push({
      key: todayKey(date),
      label: ["日", "一", "二", "三", "四", "五", "六"][date.getDay()],
      value: Number(state.days[todayKey(date)] || 0),
      today: offset === 0,
    });
  }

  const max = Math.max(1, ...chartData.map((item) => item.value));
  return chartData
    .map(
      (item) => `
        <div class="chart-day ${item.today ? "is-today" : ""}">
          <div class="chart-bar-track">
            <span
              class="chart-bar"
              style="height:${item.value ? Math.max(8, (item.value / max) * 100) : 3}%"
              title="${item.value} 个"
            ></span>
          </div>
          <span>${item.label}</span>
        </div>
      `,
    )
    .join("");
}

function renderWeakSound(sound) {
  const scores = [];
  sound.words.forEach((id) => {
    const values = state.pronunciation.byWord[id] || [];
    values.forEach((score) => scores.push(Number(score)));
  });

  const average = scores.length
    ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
    : null;
  const status =
    average === null ? "等待数据" : average >= 88 ? "掌握良好" : average >= 72 ? "继续巩固" : "重点练习";

  return `
    <div class="weak-sound-row">
      <strong>${escapeHtml(sound.ipa)}</strong>
      <span class="weak-sound-copy">
        <strong>${status}</strong>
        <span>${escapeHtml(sound.label)} · ${escapeHtml(sound.hint)}</span>
      </span>
      <span class="weak-sound-score" ${average !== null && average >= 88 ? 'style="color:#267257"' : ""}>
        ${average === null ? "--" : average}
      </span>
    </div>
  `;
}

function renderAccentButtons() {
  return `
    <div class="accent-row">
      <button
        class="accent-button ${state.accent === "UK" ? "is-active" : ""}"
        type="button"
        data-action="set-accent"
        data-accent="UK"
      >
        英式 UK
      </button>
      <button
        class="accent-button ${state.accent === "US" ? "is-active" : ""}"
        type="button"
        data-action="set-accent"
        data-accent="US"
      >
        美式 US
      </button>
    </div>
  `;
}

function renderRecordResult() {
  if (recording.isRecording || !recording.blobUrl) {
    return "";
  }

  if (recording.score === null) {
    return `
      <div class="recording-result">
        <div class="attempt-score" style="--score:0deg;--score-color:#8a9894">
          <div class="attempt-score-inner">
            <div>
              <strong>✓</strong>
              <span>已录音</span>
            </div>
          </div>
        </div>
        <div class="attempt-copy">
          <strong>录音已保存，时长 ${formatSeconds(recording.duration)}</strong>
          <p>${
            recording.error === "not-supported"
              ? "当前浏览器不支持自动语音识别，请回放录音，对照示范音自行比较。"
              : "没有识别到清晰语音。请在安静环境下靠近麦克风，再读一次。"
          }</p>
        </div>
      </div>
      <div class="attempt-actions">
        <button class="mini-button" type="button" data-action="play-recording">
          ${icon("play")} 回放录音
        </button>
        <button class="mini-button is-coral" type="button" data-action="clear-recording">
          ${icon("trash-2")} 重新录制
        </button>
      </div>
    `;
  }

  const scoreColor =
    recording.score >= 88 ? "#267257" : recording.score >= 72 ? "#d39226" : "#e96045";
  const scoreMessage =
    recording.score >= 88
      ? "发音清晰，和示范音很接近。"
      : recording.score >= 72
        ? "整体不错，注意重音和尾音。"
        : "再听一次示范，放慢速度模仿。";

  return `
    <div class="recording-result">
      <div
        class="attempt-score"
        style="--score:${recording.score * 3.6}deg;--score-color:${scoreColor}"
      >
        <div class="attempt-score-inner">
          <div>
            <strong>${recording.score}</strong>
            <span>跟读分</span>
          </div>
        </div>
      </div>
      <div class="attempt-copy">
        <strong>${escapeHtml(scoreMessage)}</strong>
        <p>识别结果：${escapeHtml(recording.transcript || "—")} · 录音 ${formatSeconds(
          recording.duration,
        )}</p>
      </div>
    </div>
    <div class="attempt-actions">
      <button class="mini-button" type="button" data-action="play-recording">
        ${icon("play")} 回放录音
      </button>
      <button class="mini-button" type="button" data-action="play-demo">
        ${icon("volume-2")} 再听示范
      </button>
      <button class="mini-button is-coral" type="button" data-action="clear-recording">
        ${icon("rotate-ccw")} 再读一次
      </button>
    </div>
  `;
}

function renderWordSheet(id) {
  const word = wordMap.get(id);
  if (!word) return;

  const unit = unitMap.get(word.unitKey);
  const term = termMap.get(word.termKey);
  const learned = getLearnedSet().has(word.id);
  const mastery = Number(state.mastery[word.id] || 0);
  const ipa = state.accent === "UK" ? word.ipaUK : word.ipaUS;

  wordSheet.innerHTML = `
    <header class="sheet-header">
      <button class="icon-button" type="button" data-action="close-sheet" title="关闭">
        ${icon("x")}
      </button>
      <div class="sheet-header-title">
        <strong>单词跟读</strong>
        <span>${learned ? `掌握度 ${mastery}/3` : "听示范 · 录音 · 回放"}</span>
      </div>
      <button class="icon-button" type="button" data-action="mark-mastered" title="标记已学习">
        ${icon(learned ? "bookmark-check" : "bookmark")}
      </button>
    </header>

    <div class="sheet-body">
      <section class="word-hero">
        <span class="word-topic-chip" style="--topic-color:${term?.color || "#267257"}">
          ${icon(term?.icon || "book-open")} ${escapeHtml(word.termLabel)} · Unit ${word.unitNo}
        </span>
        <h1>${escapeHtml(word.word)}</h1>
        <div class="word-hero-ipa">
          <strong>${escapeHtml(ipa)}</strong>
          <span>${state.accent === "UK" ? "英式" : "美式"}</span>
        </div>
        <p class="word-hero-meaning">${escapeHtml(word.meaning)}</p>
        <span class="word-hero-pos">${escapeHtml(word.pos)} · ${escapeHtml(
          unit?.title || "",
        )} · ${escapeHtml(unit?.titleZh || "")}</span>
      </section>

      ${renderAccentButtons()}

      <div class="pronounce-controls">
        <button class="pronounce-button" type="button" data-action="speak-word" data-word="${word.id}">
          <i>${icon("volume-2")}</i>
          听示范
        </button>
        <button class="pronounce-button" type="button" data-action="speak-slow" data-word="${word.id}">
          <i>${icon("snail")}</i>
          慢速读
        </button>
        <button class="pronounce-button" type="button" data-action="speak-example" data-word="${word.id}">
          <i>${icon("message-square-quote")}</i>
          听例句
        </button>
      </div>

      <div class="syllable-strip">
        ${word.syllables
          .split("·")
          .map((part, index) => `${index ? "<i></i>" : ""}<span>${escapeHtml(part)}</span>`)
          .join("")}
      </div>

      <section class="follow-panel" id="followPanel">
        <div class="follow-panel-head">
          <div>
            <h2>音标跟读</h2>
            <p>点击麦克风，完整读出单词。最长录音 7 秒。</p>
          </div>
          <span class="recording-quality">${
            window.SpeechRecognition || window.webkitSpeechRecognition
              ? "支持自动评分"
              : "录音对比"
          }</span>
        </div>
        <div class="record-zone">
          <button
            class="record-button ${recording.isRecording ? "is-recording" : ""}"
            type="button"
            data-action="record-toggle"
            title="${recording.isRecording ? "停止录音" : "开始录音"}"
          >
            ${icon(recording.isRecording ? "square" : "mic")}
          </button>
          <span class="record-label">${recording.isRecording ? "正在录音，点击停止" : "点击开始跟读"}</span>
          <span class="record-timer" id="recordTimer">${
            recording.isRecording ? elapsedRecordingTime() : formatSeconds(recording.duration)
          }</span>
          <div class="waveform ${recording.isRecording ? "is-active" : ""}" aria-hidden="true">
            ${Array.from({ length: 17 }, () => "<i></i>").join("")}
          </div>
        </div>
        ${renderRecordResult()}
      </section>

      <section class="example-block">
        <div class="example-block-head">
          <h2>例句语境</h2>
          <button
            class="sound-button"
            type="button"
            data-action="speak-example"
            data-word="${word.id}"
            title="播放例句"
          >
            ${icon("volume-2")}
          </button>
        </div>
        <p>${escapeHtml(word.example)}</p>
        <p class="example-zh">${escapeHtml(word.exampleZh)}</p>
      </section>

      <section class="detail-section">
        <h2>常用搭配</h2>
        <div class="collocation-list">
          ${word.collocations
            .map((item) => `<div class="collocation-row"><i></i>${escapeHtml(item)}</div>`)
            .join("")}
        </div>
      </section>

      <section class="detail-section">
        <div class="tip-block">
          ${icon("sparkles")}
          <div>
            <strong>发音提示</strong>
            <p>${escapeHtml(word.tip)}</p>
          </div>
        </div>
      </section>

      <div class="sheet-footer">
        <button class="ghost-button" type="button" data-action="speak-word" data-word="${word.id}">
          ${icon("volume-2")} 再听一次
        </button>
        <button class="secondary-button" type="button" data-action="mark-mastered">
          ${icon(learned ? "check-check" : "check")} ${learned ? "继续巩固" : "完成学习"}
        </button>
      </div>
    </div>
  `;

  renderIcons();
}

function elapsedRecordingTime() {
  if (!recordStartedAt) return "0.0s";
  return `${((Date.now() - recordStartedAt) / 1000).toFixed(1)}s`;
}

function openWord(id, options = {}) {
  const word = wordMap.get(id);
  if (!word) return;

  window.clearTimeout(sheetCloseTimer);
  stopSpeech();
  cleanupRecording();
  state.currentWord = id;

  renderWordSheet(id);
  sheetScrim.hidden = false;
  wordSheet.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => {
    wordSheet.classList.add("is-open");
    sheetScrim.classList.add("is-open");
  });

  if (options.startRecording) {
    startRecording();
    window.setTimeout(() => {
      document.querySelector("#followPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 180);
  } else if (state.settings.autoPlay) {
    speakText(word.word, { rate: 0.88 });
  }
}

function closeWordSheet() {
  stopSpeech();
  cleanupRecording();
  wordSheet.classList.remove("is-open");
  sheetScrim.classList.remove("is-open");
  wordSheet.setAttribute("aria-hidden", "true");
  state.currentWord = null;

  sheetCloseTimer = window.setTimeout(() => {
    if (!wordSheet.classList.contains("is-open")) {
      sheetScrim.hidden = true;
      wordSheet.innerHTML = "";
    }
  }, 340);
}

function chooseVoice(lang) {
  if (!("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  const normalized = lang.toLowerCase();
  return (
    voices.find((voice) => voice.lang.toLowerCase() === normalized) ||
    voices.find((voice) => voice.lang.toLowerCase().startsWith(normalized.slice(0, 2))) ||
    null
  );
}

function stopSpeech() {
  speechToken += 1;
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  activeUtterance = null;
  document.querySelectorAll(".is-speaking").forEach((element) => {
    element.classList.remove("is-speaking");
  });
}

function speakText(text, options = {}) {
  if (!("speechSynthesis" in window)) {
    showToast("当前浏览器不支持语音播放。");
    return;
  }

  stopSpeech();
  const token = ++speechToken;
  const lang = options.lang || (state.accent === "UK" ? "en-GB" : "en-US");
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = options.rate || 0.9;
  utterance.pitch = 1;
  utterance.volume = 1;

  const voice = chooseVoice(lang);
  if (voice) {
    utterance.voice = voice;
  }

  const speakingElement = options.element || null;
  if (speakingElement) {
    speakingElement.classList.add("is-speaking");
  }

  utterance.onend = () => {
    if (token === speechToken) {
      activeUtterance = null;
      if (speakingElement) speakingElement.classList.remove("is-speaking");
    }
  };
  utterance.onerror = () => {
    if (speakingElement) speakingElement.classList.remove("is-speaking");
  };

  activeUtterance = utterance;
  window.speechSynthesis.speak(utterance);
}

function startRecording() {
  const word = wordMap.get(state.currentWord);
  if (!word) return;

  if (recording.requesting) return;

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showToast("当前浏览器不支持录音，请使用 Safari、Chrome 或 Edge 的较新版本。");
    return;
  }

  cleanupRecording();
  lastTranscript = "";
  lastFinalTranscript = "";
  lastInterimTranscript = "";
  recordedChunks = [];
  recording.requesting = true;

  navigator.mediaDevices
    .getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    .then((stream) => {
      mediaStream = stream;
      const preferredTypes = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/webm",
        "audio/ogg;codecs=opus",
      ];
      const mimeType = preferredTypes.find((type) =>
        typeof MediaRecorder.isTypeSupported === "function"
          ? MediaRecorder.isTypeSupported(type)
          : false,
      );
      mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data?.size) recordedChunks.push(event.data);
      };
      mediaRecorder.onstop = () => {
        window.setTimeout(buildRecordingResult, 450);
      };

      recording.requesting = false;
      recording.isRecording = true;
      recordStartedAt = Date.now();
      mediaRecorder.start(120);
      startSpeechRecognition();
      startRecordTimer();
      renderWordSheet(word.id);

      recordAutoStop = window.setTimeout(() => {
        if (recording.isRecording) stopRecording();
      }, 7000);
    })
    .catch((error) => {
      recording.requesting = false;
      const denied = error?.name === "NotAllowedError" || error?.name === "SecurityError";
      showToast(
        denied
          ? "需要麦克风权限才能跟读。请在浏览器地址栏中允许麦克风。"
          : "无法启动麦克风，请检查设备后重试。",
      );
    });
}

function startSpeechRecognition() {
  const RecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!RecognitionClass) {
    recording.error = "not-supported";
    return;
  }

  try {
    speechRecognition = new RecognitionClass();
    speechRecognition.lang = state.accent === "UK" ? "en-GB" : "en-US";
    speechRecognition.continuous = false;
    speechRecognition.interimResults = true;
    speechRecognition.maxAlternatives = 3;

    speechRecognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) {
          finalText += `${result[0].transcript} `;
        } else {
          interimText += `${result[0].transcript} `;
        }
      }
      if (finalText.trim()) {
        lastFinalTranscript = `${lastFinalTranscript} ${finalText}`.trim();
      }
      lastInterimTranscript = interimText.trim();
      lastTranscript = `${lastFinalTranscript} ${lastInterimTranscript}`.trim();
    };

    speechRecognition.onerror = (event) => {
      if (event.error !== "aborted" && event.error !== "no-speech") {
        recording.error = event.error;
      }
    };

    speechRecognition.onend = () => {
      if (recording.blobUrl) {
        buildRecordingResult();
      }
    };

    speechRecognition.start();
  } catch (error) {
    speechRecognition = null;
  }
}

function startRecordTimer() {
  window.clearInterval(recordTimer);
  recordTimer = window.setInterval(() => {
    const timer = document.querySelector("#recordTimer");
    if (timer && recording.isRecording) {
      timer.textContent = elapsedRecordingTime();
    }
  }, 80);
}

function stopRecording() {
  if (!recording.isRecording) return;

  const wordId = state.currentWord;
  recording.isRecording = false;
  window.clearInterval(recordTimer);
  window.clearTimeout(recordAutoStop);

  if (speechRecognition) {
    try {
      speechRecognition.stop();
    } catch (error) {
      // Recognition may already be stopped by the browser.
    }
  }

  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    recording.duration = Math.max(0.2, (Date.now() - recordStartedAt) / 1000);
    mediaRecorder.stop();
  }

  if (wordId === state.currentWord) {
    renderWordSheet(wordId);
  }
}

function buildRecordingResult() {
  if (!recordedChunks.length || !state.currentWord || recording.finalized) return;

  const word = wordMap.get(state.currentWord);
  if (!word) return;
  recording.finalized = true;

  const mimeType = mediaRecorder?.mimeType || recordedChunks[0]?.type || "audio/webm";
  const blob = new Blob(recordedChunks, { type: mimeType });
  if (!recording.blobUrl) {
    recording.blobUrl = URL.createObjectURL(blob);
  }
  recording.duration = Math.max(
    recording.duration,
    Math.min(7, (Date.now() - recordStartedAt) / 1000 || 0.2),
  );
  recording.transcript = normalizeText(lastTranscript);
  recording.score = pronunciationScore(word.word, recording.transcript);

  if (recording.score !== null) {
    state.pronunciation.attempts += 1;
    state.pronunciation.totalScore += recording.score;
    if (!state.pronunciation.byWord[word.id]) {
      state.pronunciation.byWord[word.id] = [];
    }
    state.pronunciation.byWord[word.id].push(recording.score);
    state.pronunciation.byWord[word.id] = state.pronunciation.byWord[word.id].slice(-8);

    if (recording.score >= 75) {
      markWordLearned(word.id, 1);
    }
    saveState();
  }

  renderWordSheet(word.id);
  if (recording.score !== null) {
    showToast(
      recording.score >= 88
        ? `跟读 ${recording.score} 分，发音很清晰。`
        : `跟读 ${recording.score} 分，再听一次重音位置。`,
    );
  }
}

function cleanupRecording() {
  window.clearInterval(recordTimer);
  window.clearTimeout(recordAutoStop);

  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    try {
      mediaRecorder.stop();
    } catch (error) {
      // Ignore cleanup errors.
    }
  }

  if (speechRecognition) {
    try {
      speechRecognition.abort();
    } catch (error) {
      // Ignore cleanup errors.
    }
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
  }

  if (recording.blobUrl) {
    URL.revokeObjectURL(recording.blobUrl);
  }

  mediaRecorder = null;
  mediaStream = null;
  speechRecognition = null;
  recordedChunks = [];
  lastTranscript = "";
  lastFinalTranscript = "";
  lastInterimTranscript = "";
  recordStartedAt = 0;
  recording = {
    isRecording: false,
    requesting: false,
    finalized: false,
    blobUrl: "",
    duration: 0,
    transcript: "",
    score: null,
    error: "",
  };
}

function playRecording() {
  if (!recording.blobUrl) return;
  const audio = new Audio(recording.blobUrl);
  audio.play().catch(() => showToast("暂时无法播放录音，请重试。"));
}

function speakWord(id, rate = 0.9, element = null) {
  const word = wordMap.get(id);
  if (!word) return;
  speakText(word.word, { rate, element });
}

function handleGlobalAction(event) {
  window.__yueEventProbe = (window.__yueEventProbe || 0) + 1;
  const actionElement = event.target.closest("[data-action]");
  if (!actionElement) return;

  const action = actionElement.dataset.action;
  const wordId = actionElement.dataset.word;

  if (action === "go-profile") {
    setView("profile");
  } else if (action === "continue-daily") {
    openWord(wordId);
  } else if (action === "open-word") {
    event.preventDefault();
    openWord(wordId);
  } else if (action === "home-follow") {
    event.preventDefault();
    openWord(wordId, { startRecording: true });
  } else if (action === "speak-word") {
    event.stopPropagation();
    speakWord(wordId, 0.9, actionElement);
  } else if (action === "speak-slow") {
    event.stopPropagation();
    speakWord(wordId, 0.58, actionElement);
  } else if (action === "speak-example") {
    event.stopPropagation();
    const word = wordMap.get(wordId);
    if (word) {
      speakText(word.example, { rate: 0.78, element: actionElement });
    }
  } else if (action === "set-accent") {
    state.accent = actionElement.dataset.accent;
    saveState();
    renderWordSheet(state.currentWord);
  } else if (action === "toggle-accent") {
    state.accent = state.accent === "UK" ? "US" : "UK";
    saveState();
    render();
  } else if (action === "speak-focus") {
    const sound = focusSounds[Number(actionElement.dataset.soundIndex)];
    if (sound) {
      const firstWord = wordMap.get(sound.words[0]);
      speakText(firstWord.word, { rate: 0.76, element: actionElement });
    }
  } else if (action === "select-level") {
    state.level = actionElement.dataset.level === "primary" ? "primary" : "middle";
    state.termKey = state.level === "primary" ? "P3A" : "7A";
    state.unitKey = "全部";
    state.search = "";
    if (state.view === "library") {
      saveState();
      render();
    } else {
      setView("library");
    }
  } else if (action === "select-term") {
    state.termKey = actionElement.dataset.term;
    state.unitKey = "全部";
    state.search = "";
    if (state.view === "library") {
      saveState();
      render();
    } else {
      setView("library");
    }
  } else if (action === "select-unit") {
    state.unitKey = actionElement.dataset.unit;
    state.search = "";
    saveState();
    render();
  } else if (action === "clear-unit") {
    state.unitKey = "全部";
    saveState();
    render();
  } else if (action === "go-speaking") {
    setView("speaking");
  } else if (action === "clear-filters") {
    state.termKey = state.level === "primary" ? "P3A" : "7A";
    state.unitKey = "全部";
    state.topic = "全部";
    state.search = "";
    saveState();
    render();
  } else if (action === "clear-search") {
    state.search = "";
    saveState();
    render();
    window.setTimeout(() => document.querySelector("#wordSearch")?.focus(), 0);
  } else if (action === "start-quiz") {
    createQuizSession(actionElement.dataset.mode);
  } else if (action === "answer-option") {
    answerQuiz(actionElement.dataset.option);
  } else if (action === "next-question") {
    nextQuizQuestion();
  } else if (action === "repeat-quiz-audio") {
    speakWord(wordId, 0.9, actionElement);
  } else if (action === "exit-quiz") {
    state.quizSession = null;
    saveState();
    render();
  } else if (action === "restart-quiz") {
    const mode = state.quizSession?.mode || "meaning";
    state.quizSession = null;
    createQuizSession(mode === "wrong" ? "meaning" : mode);
  } else if (action === "close-sheet") {
    closeWordSheet();
  } else if (action === "record-toggle") {
    if (recording.isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  } else if (action === "play-recording") {
    playRecording();
  } else if (action === "play-demo") {
    speakWord(state.currentWord, 0.86, actionElement);
  } else if (action === "clear-recording") {
    const currentWord = state.currentWord;
    cleanupRecording();
    renderWordSheet(currentWord);
  } else if (action === "mark-mastered") {
    const currentWord = state.currentWord;
    if (currentWord) {
      markWordLearned(currentWord, 1);
      renderWordSheet(currentWord);
      showToast(
        Number(state.mastery[currentWord] || 0) >= 2
          ? "已加入熟练词，继续巩固。"
          : "已记录学习，再跟读一次会记得更牢。",
      );
    }
  } else if (action === "toggle-setting") {
    const setting = actionElement.dataset.setting;
    state.settings[setting] = !state.settings[setting];
    saveState();
    render();
  } else if (action === "reset-progress") {
    if (window.confirm("确定清空本机所有学习记录吗？此操作无法撤销。")) {
      localStorage.removeItem(STORAGE_KEY);
      state = cloneDefaultState();
      closeWordSheet();
      render();
      showToast("学习记录已清空。");
    }
  }
}

document.addEventListener("click", handleGlobalAction);
window.__yueSetupProbe = true;

document.addEventListener("input", (event) => {
  if (event.target.id !== "wordSearch") return;
  state.search = event.target.value;
  saveState();
  renderLibraryList();
});

document.addEventListener("keydown", (event) => {
  const row = event.target.closest('.word-row[role="button"]');
  if (!row || event.target !== row || (event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  row.click();
});

document.querySelector(".tabbar").addEventListener("click", (event) => {
  const tab = event.target.closest("[data-tab]");
  if (!tab) return;
  setView(tab.dataset.tab);
});

sheetScrim.addEventListener("click", closeWordSheet);

window.addEventListener("beforeunload", () => {
  stopSpeech();
  cleanupRecording();
});

if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    // Voices are loaded lazily on some browsers; the next utterance will use them.
  };
}

render();

if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js?v=4").catch(() => {});
  });
}
