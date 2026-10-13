"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

class TestRunner {
  constructor() {
    this.tests = [];
    this.ok = 0;
    this.fail = 0;
  }

  describe(_suiteName, suiteFunc) {
    suiteFunc();
  }

  it(testName, testFunc) {
    this.tests.push({ testName, testFunc });
  }

  async run() {
    for (const { testName, testFunc } of this.tests) {
      try {
        await testFunc();
        this.ok++;
        console.log(`\u2713 ${testName}`);
      } catch (error) {
        this.fail++;
        console.log(`\u2717 ${testName}`);
        console.log(`  ${error.message}`);
      }
    }
    console.log(`\n${this.ok} ok, ${this.fail} failed`);
    process.exit(this.fail > 0 ? 1 : 0);
  }
}

function expect(value) {
  return {
    toBe(expected) {
      if (value !== expected) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
      }
    },
    toContain(expected) {
      if (typeof value !== "string" || !value.includes(expected)) {
        throw new Error(`Expected ${JSON.stringify(value)} to contain ${JSON.stringify(expected)}`);
      }
    },
  };
}

function makeElement(initial = {}) {
  const element = {
    value: "",
    disabled: false,
    checked: false,
    textContent: "",
    className: "",
    children: [],
    addEventListener() {},
    appendChild(node) {
      this.children.push(node);
    },
    classList: {
      add() {},
      remove() {},
    },
    ...initial,
  };
  let innerHtml = "";
  Object.defineProperty(element, "innerHTML", {
    get() {
      return innerHtml;
    },
    set(value) {
      innerHtml = String(value);
      this.children = [];
    },
  });
  return element;
}

async function runScript({
  scriptPath,
  pathname,
  injectedBasePath,
  fetchImpl,
}) {
  const source = fs.readFileSync(scriptPath, "utf8");
  const listeners = new Map();
  const elements = {
    overrideMode: makeElement({ value: "player_common" }),
    overrideNames: makeElement(),
    statusLine: makeElement(),
    webbuildState: makeElement(),
    out: makeElement(),
    dropZone: makeElement(),
    applyBtn: makeElement(),
    reapplyBtn: makeElement(),
    startBtn: makeElement(),
    openBtn: makeElement(),
    reloadBtn: makeElement(),
    downloadInfoBtn: makeElement(),
    xpFile: makeElement(),
    webbuildPath: makeElement({ value: "./termpp-web/index.html?solo=1&player=player" }),
    playerName: makeElement({ value: "player" }),
    autoStartChk: makeElement(),
    gameFrame: makeElement({ contentWindow: null, src: "" }),
  };
  const document = {
    getElementById(id) {
      return elements[id] || null;
    },
    createElement() {
      return makeElement();
    },
  };
  const fetchCalls = [];
  const context = {
    console,
    URLSearchParams,
    Uint8Array,
    setInterval() { return 1; },
    clearInterval() {},
    setTimeout,
    clearTimeout,
    fetch: async (url) => {
      fetchCalls.push(url);
      return fetchImpl(url);
    },
    localStorage: {
      getItem() { return null; },
      setItem() {},
    },
    document,
    window: {
      location: { pathname, search: "" },
      __WB_BASE_PATH: injectedBasePath,
      addEventListener(eventName, callback) {
        listeners.set(eventName, callback);
      },
      removeEventListener() {},
    },
  };
  context.window.window = context.window;
  context.window.document = document;
  context.window.fetch = context.fetch;
  context.window.localStorage = context.localStorage;
  context.globalThis = context;

  vm.runInNewContext(source, context, { filename: scriptPath });
  const onReady = listeners.get("DOMContentLoaded");
  if (typeof onReady !== "function") {
    throw new Error("DOMContentLoaded listener not registered");
  }
  await onReady();
  return { elements, fetchCalls };
}

const t = new TestRunner();
const repoRoot = process.cwd();
const webScriptPath = path.join(repoRoot, "web", "termpp_skin_lab.js");
const runtimeScriptPath = path.join(repoRoot, "runtime", "termpp-skin-lab-static", "termpp_skin_lab.js");

const MOCK_REGISTRY = {
  prefix_catalog: {
    player: { ahsw_range: "all_16" },
    attack: { ahsw_range: "weapon_gte_1" },
    plydie: { ahsw_range: "all_16" },
    wolfie: { ahsw_range: "all_16" },
    wolack: { ahsw_range: "weapon_gte_1" },
  },
};

t.describe("termpp skin lab registry loading", () => {
  t.it("keeps both termpp skin lab copies byte-identical", async () => {
    const webScript = fs.readFileSync(webScriptPath, "utf8");
    const runtimeScript = fs.readFileSync(runtimeScriptPath, "utf8");
    expect(webScript).toBe(runtimeScript);
  });

  t.it("injects uploaded skins into the engine asset path", async () => {
    const webScript = fs.readFileSync(webScriptPath, "utf8");
    expect(webScript).toContain('M.FS_createPath("/", "assets", true, true)');
    expect(webScript).toContain('M.FS_createPath("/assets", "sprites", true, true)');
    expect(webScript).toContain("`/assets/sprites/${name}`");
  });

  t.it("uses injected BASE_PATH for registry fetch on prefixed termpp-skin-lab route", async () => {
    const { fetchCalls } = await runScript({
      scriptPath: webScriptPath,
      pathname: "/xpedit/termpp-skin-lab",
      injectedBasePath: "/xpedit",
      fetchImpl: async () => ({ ok: true, json: async () => MOCK_REGISTRY }),
    });
    expect(fetchCalls[0]).toBe("/xpedit/api/workbench/templates");
  });

  t.it("infers BASE_PATH from termpp-web-flat pathname when no injected base path exists", async () => {
    const { fetchCalls } = await runScript({
      scriptPath: webScriptPath,
      pathname: "/xpedit/termpp-web-flat/index.html",
      injectedBasePath: "",
      fetchImpl: async () => ({ ok: true, json: async () => MOCK_REGISTRY }),
    });
    expect(fetchCalls[0]).toBe("/xpedit/api/workbench/templates");
  });

  t.it("fails closed when the registry fetch fails instead of regenerating hardcoded player_common names", async () => {
    const { elements } = await runScript({
      scriptPath: webScriptPath,
      pathname: "/xpedit/termpp-skin-lab",
      injectedBasePath: "/xpedit",
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });
    expect(elements.overrideNames.children.length).toBe(0);
    expect(elements.statusLine.textContent).toContain("Template registry unavailable");
  });

  t.it("renders the full player_common override set only after registry load succeeds", async () => {
    const { elements } = await runScript({
      scriptPath: webScriptPath,
      pathname: "/xpedit/termpp-skin-lab",
      injectedBasePath: "/xpedit",
      fetchImpl: async () => ({ ok: true, json: async () => MOCK_REGISTRY }),
    });
    expect(elements.overrideNames.children.length).toBe(105);
  });
});

void t.run();
