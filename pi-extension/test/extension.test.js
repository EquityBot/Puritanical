import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import puritanicalExtension, { parsePuritanicalCommand } from "../index.js";

function createPiHarness() {
  const events = new Map();
  const commands = new Map();
  const appendedEntries = [];
  const sentUserMessages = [];

  const pi = {
    on(eventName, handler) {
      events.set(eventName, handler);
    },
    registerCommand(name, options) {
      commands.set(name, options);
    },
    appendEntry(customType, data) {
      appendedEntries.push({ customType, data });
    },
    sendUserMessage(text, options) {
      sentUserMessages.push({ text, options });
    },
  };

  puritanicalExtension(pi);
  return { events, commands, appendedEntries, sentUserMessages };
}

function createCommandContext(overrides = {}) {
  return {
    isIdle: () => true,
    sessionManager: { getEntries: () => [] },
    ui: { notify() {} },
    ...overrides,
  };
}

function withTempConfig(fn) {
  const tempConfigHome = mkdtempSync(join(tmpdir(), "puritanical-test-"));
  const previousXdg = process.env.XDG_CONFIG_HOME;
  const previousHide = process.env.PURITANICAL_HIDE_STATUS;
  const previousDefault = process.env.PURITANICAL_DEFAULT_MODE;
  process.env.XDG_CONFIG_HOME = tempConfigHome;
  delete process.env.PURITANICAL_HIDE_STATUS;
  delete process.env.PURITANICAL_DEFAULT_MODE;

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdg;
      if (previousHide === undefined) delete process.env.PURITANICAL_HIDE_STATUS;
      else process.env.PURITANICAL_HIDE_STATUS = previousHide;
      if (previousDefault === undefined) delete process.env.PURITANICAL_DEFAULT_MODE;
      else process.env.PURITANICAL_DEFAULT_MODE = previousDefault;
      rmSync(tempConfigHome, { recursive: true, force: true });
    });
}

test("extension registers Puritanical commands", () => {
  const { commands } = createPiHarness();

  assert.deepEqual([...commands.keys()].sort(), ["puritanical", "puritanical-audit", "puritanical-debt", "puritanical-help", "puritanical-review"]);
});

test("/puritanical updates session mode and injects instructions", async () => withTempConfig(async () => {
  const { commands, events, appendedEntries } = createPiHarness();
  const ctx = createCommandContext();

  await events.get("session_start")({ reason: "startup" }, ctx);
  await commands.get("puritanical").handler("ultra", ctx);

  assert.deepEqual(appendedEntries.at(-1), {
    customType: "puritanical-mode",
    data: { mode: "ultra" },
  });

  const result = await events.get("before_agent_start")({ systemPrompt: "BASE" }, ctx);
  assert.ok(result.systemPrompt.includes("PURITANICAL MODE ACTIVE"));
  assert.ok(result.systemPrompt.includes("ultra"));
}));

test("before_agent_start guards missing event and missing systemPrompt (#439, #440)", async () => withTempConfig(async () => {
  const { events } = createPiHarness();
  const ctx = createCommandContext();
  await events.get("session_start")({ reason: "startup" }, ctx); // currentMode -> default (full)

  // #439: a null/undefined event must not crash, and still injects the ruleset.
  for (const bad of [undefined, null]) {
    const r = await events.get("before_agent_start")(bad, ctx);
    assert.ok(r.systemPrompt.includes("PURITANICAL MODE ACTIVE"));
    assert.ok(!r.systemPrompt.includes("undefined"), "must not contain the literal 'undefined'");
  }

  // #440: an event without a systemPrompt must not prepend the literal "undefined".
  const empty = await events.get("before_agent_start")({}, ctx);
  assert.ok(empty.systemPrompt.includes("PURITANICAL MODE ACTIVE"));
  assert.ok(!empty.systemPrompt.startsWith("undefined"), "must not start with 'undefined'");

  // A real base prompt is still preserved and prepended.
  const withBase = await events.get("before_agent_start")({ systemPrompt: "BASE" }, ctx);
  assert.ok(withBase.systemPrompt.startsWith("BASE\n\n"));
  assert.ok(withBase.systemPrompt.includes("PURITANICAL MODE ACTIVE"));
}));

test("before_agent_start keeps OMP prompt parts and uses Pi sections (#776, #953)", async () => withTempConfig(async () => {
  const { commands, events } = createPiHarness();
  const ctx = createCommandContext();
  await events.get("session_start")({ reason: "startup" }, ctx);

  // OMP: systemPrompt is an array of parts; they must stay separate, not comma-joined.
  const omp = await events.get("before_agent_start")({ systemPrompt: ["A", "B"] }, ctx);
  assert.deepEqual(omp.systemPrompt.slice(0, 2), ["A", "B"]);
  assert.match(omp.systemPrompt[2], /PURITANICAL MODE ACTIVE/);

  // Pi >= 0.86: write a section and leave the prompt alone; off removes it again.
  const event = { systemPrompt: "BASE", systemPromptOptions: { sections: {} } };
  assert.equal(await events.get("before_agent_start")(event, ctx), undefined);
  assert.match(event.systemPromptOptions.sections.puritanical, /PURITANICAL MODE ACTIVE/);

  // Another extension forced the prompt: Pi ignores sections then, so append to the forced text.
  const forced = { systemPrompt: "FORCED", systemPromptOptions: { sections: {}, forceSystemPrompt: "FORCED" } };
  const forcedResult = await events.get("before_agent_start")(forced, ctx);
  assert.match(forcedResult.systemPrompt, /^FORCED\n\nPURITANICAL MODE ACTIVE/);
  assert.equal(forced.systemPromptOptions.sections.puritanical, undefined);

  await commands.get("puritanical").handler("off", ctx);
  await events.get("before_agent_start")(event, ctx);
  assert.equal(event.systemPromptOptions.sections.puritanical, undefined);
}));

test("session_start restores latest persisted mode", async () => withTempConfig(async () => {
  const { events } = createPiHarness();
  const ctx = createCommandContext({
    sessionManager: {
      getEntries: () => [
        { type: "custom", customType: "puritanical-mode", data: { mode: "lite" } },
      ],
    },
  });

  await events.get("session_start")({ reason: "resume" }, ctx);
  const result = await events.get("before_agent_start")({ systemPrompt: "BASE" }, ctx);

  assert.ok(result.systemPrompt.includes("lite"));
}));

test("session_tree restores the selected branch's mode without persisting it", async () => withTempConfig(async () => {
  const { events, commands, appendedEntries } = createPiHarness();
  const lite = { type: "custom", customType: "puritanical-mode", data: { mode: "lite" } };
  const off = { type: "custom", customType: "puritanical-mode", data: { mode: "off" } };
  let branch = [lite, off];
  const statusWrites = [];
  const notifications = [];
  const ctx = createCommandContext({
    sessionManager: { getBranch: () => branch, getEntries: () => [lite, off] },
    ui: {
      notify: (text) => notifications.push(text),
      setStatus: (_key, text) => statusWrites.push(text),
      theme: { fg: (_color, text) => text },
    },
  });

  await events.get("session_start")({ reason: "resume" }, ctx);
  await commands.get("puritanical").handler("default ultra", ctx);
  assert.equal(await events.get("before_agent_start")({ systemPrompt: "BASE" }, ctx), undefined);
  const notificationCount = notifications.length;

  for (const [entries, mode] of [[[lite], "lite"], [[lite, off], "off"], [[], "ultra"]]) {
    branch = entries;
    await events.get("session_tree")?.({ type: "session_tree" }, ctx);
    const result = await events.get("before_agent_start")({ systemPrompt: "BASE" }, ctx);
    if (mode === "off") {
      assert.equal(result, undefined);
      assert.equal(statusWrites.at(-1), undefined);
    } else {
      assert.ok(result?.systemPrompt.startsWith(`BASE\n\nPURITANICAL MODE ACTIVE — level: ${mode}\n`), `expected ${mode} instructions`);
      assert.ok(statusWrites.at(-1).includes(mode.toUpperCase()));
    }
  }

  assert.deepEqual(appendedEntries, [], "navigation must not append a new mode entry");
  assert.equal(notifications.length, notificationCount, "navigation must not repeat the startup toast");
}));

test("OMP session_switch and session_branch restore the target session's mode", async () => withTempConfig(async () => {
  // OMP keeps the legacy Pi events instead of re-emitting session_start on /new, /resume, /fork and /branch.
  const { events, appendedEntries } = createPiHarness();
  const lite = { type: "custom", customType: "puritanical-mode", data: { mode: "lite" } };
  const off = { type: "custom", customType: "puritanical-mode", data: { mode: "off" } };
  let branch = [off];
  const ctx = createCommandContext({ sessionManager: { getBranch: () => branch } });

  await events.get("session_start")({ type: "session_start" }, ctx);
  for (const [type, entries, mode] of [["session_switch", [lite], "lite"], ["session_branch", [off], "off"], ["session_switch", [], "full"]]) {
    branch = entries;
    await events.get(type)?.({ type }, ctx);
    const result = await events.get("before_agent_start")({ systemPrompt: ["BASE"] }, ctx);
    if (mode === "off") assert.equal(result, undefined, `${type} should restore off`);
    else assert.ok(result?.systemPrompt.at(-1).startsWith(`PURITANICAL MODE ACTIVE — level: ${mode}\n`), `${type} should restore ${mode}`);
  }
  assert.deepEqual(appendedEntries, [], "restoring must not append a new mode entry");
}));

test("skill alias commands delegate to Pi skill commands", async () => {
  const { commands, sentUserMessages } = createPiHarness();
  const ctx = createCommandContext();

  await commands.get("puritanical-review").handler("", ctx);
  await commands.get("puritanical-audit").handler("", ctx);
  await commands.get("puritanical-debt").handler("", ctx);
  await commands.get("puritanical-help").handler("", ctx);

  assert.deepEqual(sentUserMessages.map((entry) => entry.text), [
    "/skill:puritanical-review",
    "/skill:puritanical-audit",
    "/skill:puritanical-debt",
    "/skill:puritanical-help",
  ]);
});

test("skill alias commands expand the skill and forward their arguments", async () => {
  const { commands, sentUserMessages } = createPiHarness();

  await commands.get("puritanical-review").handler("staged", createCommandContext());
  await commands.get("puritanical-audit").handler("src/api", createCommandContext({ isIdle: () => false }));

  assert.deepEqual(sentUserMessages, [
    { text: "/skill:puritanical-review staged", options: { expandPromptTemplates: true } },
    { text: "/skill:puritanical-audit src/api", options: { expandPromptTemplates: true, deliverAs: "followUp" } },
  ]);
});

test("normal mode disables persistent instructions", async () => withTempConfig(async () => {
  const { commands, events } = createPiHarness();
  const ctx = createCommandContext();

  await events.get("session_start")({ reason: "startup" }, ctx);
  await commands.get("puritanical").handler("ultra", ctx);
  await events.get("input")({ text: "normal mode", source: "interactive" }, ctx);

  const disabled = await events.get("before_agent_start")({ systemPrompt: "BASE" }, ctx);
  assert.equal(disabled, undefined);
}));

test("a request mentioning normal mode stays active", async () => withTempConfig(async () => {
  const { commands, events } = createPiHarness();
  const ctx = createCommandContext();

  await events.get("session_start")({ reason: "startup" }, ctx);
  await commands.get("puritanical").handler("ultra", ctx);
  await events.get("input")({ text: "add a normal mode toggle next to dark mode", source: "interactive" }, ctx);

  const result = await events.get("before_agent_start")({ systemPrompt: "BASE" }, ctx);
  assert.match(result.systemPrompt, /PURITANICAL MODE ACTIVE/);
}));

test("status bar renders the mode and flips active on agent_start", async () => withTempConfig(async () => {
  const { events } = createPiHarness();
  const statusWrites = [];
  const ctx = createCommandContext({
    sessionManager: { getEntries: () => [{ type: "custom", customType: "puritanical-mode", data: { mode: "ultra" } }] },
    ui: { notify() {}, setStatus: (key, text) => statusWrites.push({ key, text }), theme: { fg: (_color, text) => text } },
  });

  await events.get("session_start")({ reason: "resume" }, ctx);
  await events.get("agent_start")({}, ctx);

  assert.equal(statusWrites.at(-2).key, "puritanical");
  assert.match(statusWrites.at(-2).text, /○.*ULTRA/);
  assert.match(statusWrites.at(-1).text, /●.*ULTRA/);
}));

test("off mode clears the status bar entry", async () => withTempConfig(async () => {
  const { events } = createPiHarness();
  const statusWrites = [];
  const ctx = createCommandContext({
    sessionManager: { getEntries: () => [{ type: "custom", customType: "puritanical-mode", data: { mode: "off" } }] },
    ui: { notify() {}, setStatus: (key, text) => statusWrites.push({ key, text }), theme: { fg: (_color, text) => text } },
  });

  await events.get("session_start")({ reason: "resume" }, ctx);

  assert.deepEqual(statusWrites.at(-1), { key: "puritanical", text: undefined });
}));

test("status bar stays silent when ui lacks a theme", async () => withTempConfig(async () => {
  const { events } = createPiHarness();
  const calls = [];
  const ctx = createCommandContext({
    sessionManager: { getEntries: () => [{ type: "custom", customType: "puritanical-mode", data: { mode: "ultra" } }] },
    ui: { notify() {}, setStatus: (_key, text) => calls.push(text) }, // setStatus present, theme absent
  });

  await events.get("session_start")({ reason: "resume" }, ctx);
  await events.get("agent_start")({}, ctx);

  assert.deepEqual(calls, []);
}));

test("PURITANICAL_HIDE_STATUS hides the indicator but keeps puritanical active (#324)", async () => withTempConfig(async () => {
  process.env.PURITANICAL_HIDE_STATUS = "1";
  const { events } = createPiHarness();
  const statusWrites = [];
  const ctx = createCommandContext({
    sessionManager: { getEntries: () => [{ type: "custom", customType: "puritanical-mode", data: { mode: "ultra" } }] },
    ui: { notify() {}, setStatus: (key, text) => statusWrites.push({ key, text }), theme: { fg: (_c, t) => t } },
  });

  await events.get("session_start")({ reason: "resume" }, ctx);
  await events.get("agent_start")({}, ctx);
  const injected = await events.get("before_agent_start")({ systemPrompt: "BASE" }, ctx);

  assert.deepEqual(statusWrites, [], "status bar must not be drawn when hidden");
  assert.match(injected.systemPrompt, /PURITANICAL MODE ACTIVE/, "ruleset must still inject while status is hidden");
}));

test("config.hideStatus hides the indicator but keeps puritanical active (#324)", async () => withTempConfig(async () => {
  mkdirSync(join(process.env.XDG_CONFIG_HOME, "puritanical"), { recursive: true });
  writeFileSync(join(process.env.XDG_CONFIG_HOME, "puritanical", "config.json"), JSON.stringify({ hideStatus: true }));
  const { events } = createPiHarness();
  const statusWrites = [];
  const ctx = createCommandContext({
    ui: { notify() {}, setStatus: (key, text) => statusWrites.push({ key, text }), theme: { fg: (_c, t) => t } },
  });

  await events.get("session_start")({ reason: "startup" }, ctx);
  await events.get("agent_start")({}, ctx);
  const injected = await events.get("before_agent_start")({ systemPrompt: "BASE" }, ctx);

  assert.deepEqual(statusWrites, [], "config.hideStatus must suppress the status bar");
  assert.match(injected.systemPrompt, /PURITANICAL MODE ACTIVE/, "ruleset must still inject while status is hidden");
}));

test("PURITANICAL_HIDE_STATUS=0 does not hide the indicator", async () => withTempConfig(async () => {
  process.env.PURITANICAL_HIDE_STATUS = "0";
  const { events } = createPiHarness();
  const statusWrites = [];
  const ctx = createCommandContext({
    sessionManager: { getEntries: () => [{ type: "custom", customType: "puritanical-mode", data: { mode: "ultra" } }] },
    ui: { notify() {}, setStatus: (key, text) => statusWrites.push({ key, text }), theme: { fg: (_c, t) => t } },
  });

  await events.get("session_start")({ reason: "resume" }, ctx);
  await events.get("agent_start")({}, ctx);

  assert.ok(statusWrites.length > 0, "0 must be treated as 'do not hide'");
}));

test("/puritanical autocompletes modes, commands and default <mode>", () => {
  const { commands } = createPiHarness();
  const complete = (prefix) => commands.get("puritanical").getArgumentCompletions(prefix);

  assert.deepEqual(complete("").map((item) => item.value),
    ["off", "lite", "full", "ultra", "status", "default off", "default lite", "default full", "default ultra"]);
  assert.deepEqual(complete("fu").map((item) => item.value), ["full"]);
  assert.deepEqual(complete("default ").map((item) => item.value), ["default off", "default lite", "default full", "default ultra"]);
  assert.deepEqual(complete("default l").map((item) => item.value), ["default lite"]);
  assert.deepEqual(complete("default").map((item) => item.value),
    ["default off", "default lite", "default full", "default ultra"], "never a bare default: Enter would submit it without a mode");
  assert.equal(complete("status x"), null, "no command takes a second word after status");
  assert.equal(complete("lite x"), null);
  assert.equal(complete("bogus"), null, "nothing matches an unknown prefix");
  for (const { value } of complete("")) {
    assert.notEqual(parsePuritanicalCommand(value).type, "invalid", `Enter on "${value}" must run a valid command`);
  }
});
