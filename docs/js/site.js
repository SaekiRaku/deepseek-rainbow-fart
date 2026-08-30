/** @typedef {"light" | "dark" | "system"} ThemePreference */
/** @typedef {"conversation" | "video"} DemoMode */
/** @typedef {"available" | "missing" | "error"} MediaAvailability */
/** @typedef {"idle" | "loading" | "playing" | "paused" | "unavailable" | "error"} AudioPlaybackState */

/**
 * @typedef {object} DemoState
 * @property {DemoMode} mode
 * @property {AudioPlaybackState} audio
 * @property {MediaAvailability} audioAvailability
 */

const THEME_KEY = "rainbow-fart-theme";

const DEMO_MEDIA = {
  audio: "assets/demo-audio.wav",
};

/** @param {number} seconds @returns {string} */
function formatDemoTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

/** @returns {DemoState} */
function createDemoState() {
  return {
    mode: "conversation",
    audio: "idle",
    audioAvailability: "missing",
  };
}

/** @param {DemoState} state @param {DemoMode} mode @returns {DemoState} */
function setDemoMode(state, mode) {
  return {
    ...state,
    mode,
    audio:
      mode === "video" && (state.audio === "loading" || state.audio === "playing")
        ? "paused"
        : state.audio,
  };
}

/** @param {DemoState} state @param {AudioPlaybackState} audio @returns {DemoState} */
function setAudioState(state, audio) {
  return { ...state, mode: "conversation", audio };
}

class DemoController {
  /**
   * @param {Element} root
   * @param {{ animate?: boolean, probeMedia?: boolean }} options
   */
  constructor(root, options = {}) {
    this.root = root;
    this.state = createDemoState();
    this.conversation = root.querySelector("[data-demo-conversation]");
    this.videoState = root.querySelector("[data-demo-video]");
    this.videoToggles = [...root.querySelectorAll("[data-video-toggle]")];
    this.videoElement = root.querySelector(".demo-video-media");
    this.audioToggle = root.querySelector("[data-audio-toggle]");
    this.audioStatus = root.querySelector("[data-audio-status]");
    this.audioProgress = root.querySelector(".audio-progress i");
    this.audioTime = root.querySelector(".audio-time");
    this.audioDurationSet = false;
    this.audioElement = null;
    this.audioPlayGeneration = 0;
    this.pendingAudioPlayGeneration = null;

    this.videoToggles.forEach((toggle) => {
      toggle.addEventListener("click", () => this.toggleVideo());
    });
    this.audioToggle?.addEventListener("click", () => this.toggleAudio());

    this.render();
    if (options.animate !== false) this.startIntro();
    if (options.probeMedia !== false) void this.probeMedia("audio");
  }

  toggleVideo() {
    const mode = this.state.mode === "video" ? "conversation" : "video";
    if (mode === "video") {
      this.audioPlayGeneration += 1;
      this.audioElement?.pause();
    }
    this.state = setDemoMode(this.state, mode);
    this.render();
  }

  toggleAudio() {
    if (this.state.audioAvailability !== "available" || !this.audioElement) {
      this.state = setAudioState(
        this.state,
        this.state.audioAvailability === "error" ? "error" : "unavailable",
      );
      this.render();
      return;
    }

    if (this.state.audio === "playing") {
      this.audioPlayGeneration += 1;
      this.audioElement.pause();
      this.state = setAudioState(this.state, "paused");
      this.render();
      return;
    }

    this.videoElement?.pause();
    const playGeneration = ++this.audioPlayGeneration;
    this.pendingAudioPlayGeneration = playGeneration;
    this.state = setAudioState(this.state, "loading");
    this.render();
    this.audioElement.play().then(
      () => {
        if (
          playGeneration !== this.audioPlayGeneration ||
          this.state.audio !== "loading"
        ) {
          if (this.pendingAudioPlayGeneration === playGeneration) {
            this.pendingAudioPlayGeneration = null;
          }
          return;
        }
        this.pendingAudioPlayGeneration = null;
        this.state = setAudioState(this.state, "playing");
        this.render();
      },
      () => {
        if (playGeneration !== this.audioPlayGeneration) {
          if (this.pendingAudioPlayGeneration === playGeneration) {
            this.pendingAudioPlayGeneration = null;
          }
          return;
        }
        this.pendingAudioPlayGeneration = null;
        this.state = setAudioState(this.state, "error");
        this.render();
      },
    );
  }

  /** @param {"audio"} kind */
  probeMedia(kind) {
    const finish = (availability) => {
      this.state = { ...this.state, [`${kind}Availability`]: availability };
      if (kind === "audio") this.prepareAudio(availability);
      this.render();
    };

    const element = document.createElement("audio");
    element.preload = "metadata";
    element.muted = true;
    element.hidden = true;
    let settled = false;
    const settle = (availability) => {
      if (settled) return;
      settled = true;
      element.removeEventListener("loadedmetadata", onReady);
      element.removeEventListener("canplaythrough", onReady);
      element.removeEventListener("error", onError);
      element.remove();
      finish(availability);
    };
    const onReady = () => settle("available");
    const onError = () => settle(element.error?.code === 3 ? "error" : "missing");
    element.addEventListener("loadedmetadata", onReady);
    element.addEventListener("canplaythrough", onReady);
    element.addEventListener("error", onError);
    // 移动端/弱网下事件可能长期不触发：超时放弃并清理探测元素。
    window.setTimeout(() => settle("missing"), 10000);
    element.src = DEMO_MEDIA[kind];
    document.body?.append(element);
  }

  /** @param {MediaAvailability} availability */
  prepareAudio(availability) {
    if (availability !== "available") {
      this.state = {
        ...this.state,
        audio: availability === "missing" ? "unavailable" : "error",
      };
      return;
    }

    this.audioElement = new Audio(DEMO_MEDIA.audio);
    this.audioElement.addEventListener("play", () => {
      if (
        this.pendingAudioPlayGeneration !== null &&
        this.pendingAudioPlayGeneration !== this.audioPlayGeneration
      ) {
        this.audioElement?.pause();
        return;
      }
      if (this.state.audio === "loading") return;
      this.videoElement?.pause();
      this.state = setAudioState(this.state, "playing");
      this.render();
    });
    this.audioElement.addEventListener("pause", () => {
      this.audioPlayGeneration += 1;
      if (this.state.audio !== "loading" && this.state.audio !== "playing") return;
      this.state = setAudioState(this.state, "paused");
      this.render();
    });
    this.audioElement.addEventListener("error", () => {
      this.state = { ...setAudioState(this.state, "error"), audioAvailability: "error" };
      this.render();
    });
    this.audioElement.addEventListener("loadedmetadata", () => {
      this.audioDurationSet = false;
      this.renderAudioProgress();
    });
    this.audioElement.addEventListener("timeupdate", () => this.renderAudioProgress());
    if (this.state.audio === "unavailable" || this.state.audio === "error") {
      this.state = { ...this.state, audio: "idle" };
    }
  }

  renderAudioProgress() {
    const element = this.audioElement;
    if (!element) return;
    const { currentTime, duration } = element;
    const hasDuration = Number.isFinite(duration) && duration > 0;
    if (hasDuration) {
      const ratio = Math.min(1, Math.max(0, currentTime / duration));
      if (this.audioProgress) this.audioProgress.style.width = `${ratio * 100}%`;
    }
    if (!this.audioTime) return;
    const [current, total] = this.audioTime.querySelectorAll("span");
    if (current) current.textContent = formatDemoTime(currentTime);
    if (total && hasDuration && !this.audioDurationSet) {
      total.textContent = formatDemoTime(duration);
      this.audioDurationSet = true;
    }
  }

  render() {
    const videoMode = this.state.mode === "video";
    if (this.conversation) this.conversation.hidden = videoMode;
    if (this.videoState) this.videoState.hidden = !videoMode;
    this.root.classList.remove("demo-mode-conversation", "demo-mode-video");
    this.root.classList.add(`demo-mode-${this.state.mode}`);
    this.root.classList.remove(
      "demo-audio-idle",
      "demo-audio-loading",
      "demo-audio-playing",
      "demo-audio-paused",
      "demo-audio-unavailable",
      "demo-audio-error",
    );
    this.root.classList.add(`demo-audio-${this.state.audio}`);

    this.videoToggles.forEach((toggle) => {
      toggle.setAttribute("aria-pressed", String(videoMode));
      const label = toggle.querySelector("[data-video-label]");
      const text = videoMode ? "返回交互 Demo" : "查看演示视频";
      if (label) label.textContent = text;
      else toggle.textContent = text;
    });

    const audioLabels = {
      idle: "离线语音",
      loading: "正在加载演示音频",
      playing: "正在播放",
      paused: "已暂停",
      unavailable: "演示音频即将上线",
      error: "演示音频暂不可用",
    };
    if (this.audioStatus) this.audioStatus.textContent = audioLabels[this.state.audio];
    this.audioToggle?.setAttribute("aria-pressed", String(this.state.audio === "playing"));
  }

  startIntro() {
    const audioStage = this.root.querySelector('[data-demo-stage="audio"]');
    const finalPulse = this.root.querySelector("[data-audio-toggle]");
    const finish = () => {
      this.root.classList.remove("demo-is-animating");
      this.root.classList.add("demo-audio-focused");
    };
    this.root.classList.add("demo-is-animating");
    audioStage?.addEventListener("animationend", finish, { once: true });
    finalPulse?.addEventListener("animationend", finish, { once: true });
    window.setTimeout(finish, 2600);
  }
}

/** @param {ThemePreference} preference @param {boolean} systemDark */
function resolveTheme(preference, systemDark) {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}

/** @param {ThemePreference} preference @returns {ThemePreference} */
function nextTheme(preference) {
  if (preference === "system") return "light";
  if (preference === "light") return "dark";
  return "system";
}

/** @param {boolean} expanded */
function menuToggleLabel(expanded) {
  return expanded ? "关闭导航菜单" : "打开导航菜单";
}

function initReadingProgress() {
  const bar = document.querySelector("[data-reading-progress]");
  if (!bar) return;

  let scheduled = false;
  function renderProgress() {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const progress = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 1;
    bar.style.transform = `scaleX(${progress})`;
    scheduled = false;
  }
  function scheduleProgress() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(renderProgress);
  }

  renderProgress();
  window.addEventListener("scroll", scheduleProgress, { passive: true });
  window.addEventListener("resize", scheduleProgress);
}

function selectScrollSpySection(sectionIds, visibleIds, atBottom) {
  if (sectionIds.length === 0) return null;
  if (atBottom) return sectionIds.at(-1);
  return visibleIds[0] ?? null;
}

function initScrollSpy() {
  const nav = document.querySelector("[data-scroll-spy]");
  const sections = [...document.querySelectorAll("[data-doc-section]")];
  if (!nav || sections.length === 0 || typeof IntersectionObserver === "undefined") return;

  const links = [...nav.querySelectorAll('a[href^="#"]')];
  const visible = new Set();
  const sectionIds = sections.map((section) => section.id);
  let scrollScheduled = false;
  const activate = (id) => {
    links.forEach((link) => {
      if (link.getAttribute("href") === `#${id}`) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  };
  const renderScrollSpy = () => {
    const visibleIds = [...visible]
      .sort((first, second) => first.getBoundingClientRect().top - second.getBoundingClientRect().top)
      .map((section) => section.id);
    const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1;
    const passedIds = sections
      .filter((section) => section.getBoundingClientRect().top <= headerHeight + 28)
      .map((section) => section.id);
    const id = selectScrollSpySection(
      sectionIds,
      passedIds.length > 0 ? [passedIds.at(-1)] : visibleIds,
      atBottom,
    );
    if (id) activate(id);
  };
  const headerHeight = document.querySelector(".site-header")?.getBoundingClientRect().height ?? 68;
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      });
      renderScrollSpy();
    },
    { rootMargin: `-${headerHeight + 20}px 0px -65% 0px`, threshold: 0 },
  );
  sections.forEach((section) => observer.observe(section));
  window.addEventListener(
    "scroll",
    () => {
      if (scrollScheduled) return;
      scrollScheduled = true;
      window.requestAnimationFrame(() => {
        scrollScheduled = false;
        renderScrollSpy();
      });
    },
    { passive: true },
  );
  renderScrollSpy();
}

function initDocMenu() {
  const button = document.querySelector("[data-doc-menu]");
  if (!button) return;
  const panelId = button.getAttribute("aria-controls");
  const panel = panelId ? document.getElementById(panelId) : null;
  if (!panel) return;

  function render(expanded) {
    button.setAttribute("aria-expanded", String(expanded));
    panel.hidden = !expanded;
  }
  button.addEventListener("click", () => render(button.getAttribute("aria-expanded") !== "true"));
  panel.addEventListener("click", (event) => {
    if (event.target instanceof HTMLAnchorElement) render(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && button.getAttribute("aria-expanded") === "true") {
      render(false);
      button.focus();
    }
  });
  render(false);
}

async function copyCode(button) {
  const code = button.closest(".code-block")?.querySelector("code");
  const status = button.querySelector("[data-copy-status]");
  if (!code || !status) return;

  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(code.textContent ?? "");
    status.textContent = "已复制";
    button.classList?.add("is-copy-success");
    globalThis.setTimeout(() => {
      status.textContent = button.getAttribute("data-copy-label") ?? "复制";
      button.classList?.remove("is-copy-success");
    }, 1800);
  } catch {
    try {
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = window.getSelection();
      if (!selection) throw new Error("Selection unavailable");
      selection.removeAllRanges();
      selection.addRange(range);
      if (selection.rangeCount === 0 || selection.isCollapsed) {
        throw new Error("Code selection failed");
      }
      status.textContent = "已选中，请手动复制";
    } catch {
      status.textContent = "复制失败";
    }
  }
}

function initCodeCopy() {
  const buttons = document.querySelectorAll("[data-copy-code]");
  if (buttons.length === 0) return;
  buttons.forEach((button) => {
    const status = button.querySelector("[data-copy-status]");
    button.setAttribute("data-copy-label", status?.textContent ?? "复制");
    button.addEventListener("click", () => void copyCode(button));
  });
}

function initReveal() {
  const items = [...document.querySelectorAll("[data-reveal]")];
  if (items.length === 0) return;
  const reduceMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion || typeof IntersectionObserver === "undefined") {
    items.forEach((item) => item.classList.add("is-revealed"));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-revealed");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
  );
  items.forEach((item) => observer.observe(item));
}

function initInstallTabs() {
  const root = document.querySelector("[data-install-tabs]");
  if (!root) return;
  const tabs = [...root.querySelectorAll("[data-install-tab]")];
  const panels = [...root.querySelectorAll("[data-install-panel]")];

  function selectTab(name, focus = false) {
    tabs.forEach((tab) => {
      const selected = tab.getAttribute("data-install-tab") === name;
      tab.setAttribute("aria-selected", String(selected));
      tab.setAttribute("tabindex", selected ? "0" : "-1");
      if (selected && focus) tab.focus();
    });
    panels.forEach((panel) => {
      panel.hidden = panel.getAttribute("data-install-panel") !== name;
    });
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(tab.getAttribute("data-install-tab")));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const next = tabs[(index + direction + tabs.length) % tabs.length];
      selectTab(next.getAttribute("data-install-tab"), true);
    });
  });
  selectTab("prompt");
}

globalThis.RainbowSite = {
  THEME_KEY,
  createDemoState,
  setDemoMode,
  setAudioState,
  DemoController,
  resolveTheme,
  nextTheme,
  menuToggleLabel,
  initReadingProgress,
  selectScrollSpySection,
  initScrollSpy,
  initDocMenu,
  copyCode,
  initReveal,
  initInstallTabs,
};

if (typeof document !== "undefined") {
  document.documentElement.classList.add("js");

  const themeToggle = document.querySelector("[data-theme-toggle]");
  const menuToggle = document.querySelector("[data-menu-toggle]");
  const siteNav = document.querySelector(".site-nav");
  const demoRoot = document.querySelector("[data-agent-demo]");
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  const themeLabels = {
    system: "主题：跟随系统。点击切换为浅色主题",
    light: "主题：浅色。点击切换为深色主题",
    dark: "主题：深色。点击切换为跟随系统",
  };

  /** @returns {ThemePreference} */
  function readTheme() {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === "light" || stored === "dark" || stored === "system") return stored;
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
    return "system";
  }

  /** @param {ThemePreference} preference */
  function renderTheme(preference) {
    document.documentElement.dataset.theme = resolveTheme(preference, systemTheme.matches);
    document.documentElement.dataset.themePreference = preference;
    if (themeToggle) {
      themeToggle.setAttribute("aria-label", themeLabels[preference]);
      themeToggle.setAttribute("title", themeLabels[preference]);
    }
  }

  /** @param {ThemePreference} preference */
  function storeTheme(preference) {
    try {
      localStorage.setItem(THEME_KEY, preference);
    } catch {
      // The selected theme still applies for the lifetime of this page.
    }
  }

  /** @param {boolean} expanded */
  function renderMenu(expanded) {
    const label = menuToggleLabel(expanded);
    menuToggle?.setAttribute("aria-expanded", String(expanded));
    menuToggle?.setAttribute("aria-label", label);
    menuToggle?.setAttribute("title", label);
    siteNav?.setAttribute("data-open", String(expanded));
  }

  renderTheme(readTheme());
  if (demoRoot) new DemoController(demoRoot);
  initReadingProgress();
  initScrollSpy();
  initDocMenu();
  initCodeCopy();
  initReveal();
  initInstallTabs();

  themeToggle?.addEventListener("click", () => {
    const current = /** @type {ThemePreference} */ (
      document.documentElement.dataset.themePreference || "system"
    );
    const preference = nextTheme(current);
    storeTheme(preference);
    renderTheme(preference);
  });

  systemTheme.addEventListener("change", () => {
    const preference = /** @type {ThemePreference} */ (
      document.documentElement.dataset.themePreference || "system"
    );
    if (preference === "system") renderTheme(preference);
  });

  menuToggle?.addEventListener("click", () => {
    const expanded = menuToggle.getAttribute("aria-expanded") === "true";
    renderMenu(!expanded);
  });

  siteNav?.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLAnchorElement)) return;
    renderMenu(false);
  });
}
