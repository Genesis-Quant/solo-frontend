import assert from "node:assert/strict";
import test from "node:test";

import { appendTaskLog, parseTaskLog, shouldResetTerminalTaskLog } from "../src/assets/lib/taskLogs.ts";
import { taskLogScopes } from "../src/types/task.ts";

test("task logs keep the complete view as default-compatible scope and expose Worker output", () => {
  assert.deepEqual(taskLogScopes, ["full", "worker"]);
});

test("worker log pages preserve a blank output line at page boundaries", () => {
  const message = appendTaskLog(
    appendTaskLog("first", "\n", true),
    "third",
    true
  );

  assert.deepEqual(
    parseTaskLog(message).map((line) => line.message),
    ["first", "", "third"]
  );
});

test("terminal Worker logs keep their raw cursor instead of rescanning from the start", () => {
  assert.equal(shouldResetTerminalTaskLog("full", true), true);
  assert.equal(shouldResetTerminalTaskLog("worker", true), false);
  assert.equal(shouldResetTerminalTaskLog("worker", false), false);
});


test("ANSI-colored Loguru output keeps its level and Python source", () => {
  const line = parseTaskLog("\u001b[32m2026-09-25 20:56:05\u001b[0m [ INFO ] session.py | create_session: 166行| connected")[0];
  assert.equal(line.level, "INFO");
  assert.equal(line.file, "session.py");
  assert.equal(line.sourceLine, 166);
  assert.equal(line.message, "connected");
});
