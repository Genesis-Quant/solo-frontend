import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTypeScript } from "./loadTypeScript.mjs";

const { filterTaskLog, parseTaskLog, taskLogEntries } = loadTypeScript("../src/assets/lib/taskLogs.ts");
const timestamp = "2026-10-24 09:30:00.123";
const debug = `${timestamp} | DEBUG | worker:run:12 - debug details`;
const workerHeader = `[INFO] ${timestamp} +0800 org.apache.dolphinscheduler.plugin.task.shell.ShellTask:[66] - ->`;
const traceback = [
  `${timestamp} | DEBUG | worker:run:12 - failed: Traceback (most recent call last):`,
  "  File \"worker.py\", line 12, in run",
  "    raise ValueError(\"bad input\")",
  "    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^",
  "ValueError: bad input"
];

for (const indent of ["  ", "\t"]) {
  test(`worker-only DEBUG does not own an independent ${JSON.stringify(indent)} print`, () => {
    const print = `${indent}independent print`;
    const lines = parseTaskLog(`${debug}\n${print}\n`);
    assert.equal(lines[0].level, "DEBUG");
    assert.equal(lines[1].level, null);
    assert.equal(lines[1].format, "plain");
    assert.equal(lines[1].message, print);
    assert.equal(lines[1].continuation, false);
    assert.notEqual(lines[0].entry, lines[1].entry);
    assert.deepEqual(filterTaskLog(lines, "INFO").map((line) => line.message), [print]);
  });
}

test("a new DS worker record separates an indented print from preceding DEBUG", () => {
  const lines = parseTaskLog([
    workerHeader,
    `\t${debug}`,
    workerHeader,
    "\t  independent print"
  ].join("\n"));
  assert.equal(lines.length, 2);
  assert.equal(lines[1].lineNumber, 4);
  assert.equal(lines[1].message, "  independent print");
  assert.equal(lines[1].level, null);
  assert.equal(lines[1].continuation, false);
  assert.equal(taskLogEntries(lines).length, 2);
  assert.deepEqual(filterTaskLog(lines, "INFO"), [lines[1]]);
});

test("multiline content within a DS worker record keeps its proven log ownership", () => {
  const lines = parseTaskLog([
    workerHeader,
    `\t${debug}`,
    "\tadditional debug details",
    "\t  indented debug details",
    workerHeader,
    "\t  independent print"
  ].join("\n"));
  assert.deepEqual(lines.map((line) => line.level), ["DEBUG", "DEBUG", "DEBUG", null]);
  assert.deepEqual(taskLogEntries(lines).map((entry) => entry.length), [3, 1]);
  assert.deepEqual(lines.map((line) => line.continuation), [false, true, true, false]);
  assert.deepEqual(filterTaskLog(lines, "INFO"), [lines[3]]);
});

test("an inline DS worker Loguru record also proves multiline ownership", () => {
  const lines = parseTaskLog([
    `${workerHeader} ${debug}`,
    "\t  multiline debug details",
    workerHeader,
    "\t  independent print"
  ].join("\n"));
  assert.equal(lines[0].outerTimestamp, `${timestamp} +0800`);
  assert.equal(lines[1].level, "DEBUG");
  assert.equal(lines[1].entry, lines[0].entry);
  assert.equal(lines[2].level, null);
  assert.deepEqual(filterTaskLog(lines, "INFO"), [lines[2]]);
});

test("an existing prefixed traceback stays a single ERROR entry", () => {
  const lines = parseTaskLog(traceback.join("\n"));
  assert.equal(lines[0].message, "failed: Traceback (most recent call last):");
  assert.equal(lines[0].source, "worker:run:12");
  assert.equal(taskLogEntries(lines).length, 1);
  assert.ok(lines.every((line) => line.level === "ERROR" && line.format === "traceback"));
  assert.deepEqual(lines.map((line) => line.continuation), [false, true, true, true, true]);
  assert.deepEqual(filterTaskLog(lines, "ERROR"), lines);
});

for (const separator of [
  "During handling of the above exception, another exception occurred:",
  "The above exception was the direct cause of the following exception:"
]) {
  test(`chained exceptions stay together: ${separator}`, () => {
    const lines = parseTaskLog([
      ...traceback,
      "",
      separator,
      "",
      "Traceback (most recent call last):",
      "  File \"worker.py\", line 20, in run",
      "    raise RuntimeError(\"failed\") from error",
      "RuntimeError: failed"
    ].join("\n"));
    assert.equal(taskLogEntries(lines).length, 1);
    assert.ok(lines.every((line) => line.level === "ERROR" && line.format === "traceback"));
    assert.deepEqual(filterTaskLog(lines, "ERROR"), lines);
  });
}

test("traceback and chain evidence survives DS record boundaries, but a later print does not join", () => {
  const lines = parseTaskLog([
    workerHeader,
    ...traceback.slice(0, 2).map((line) => `\t${line}`),
    workerHeader,
    ...traceback.slice(2).map((line) => `\t${line}`),
    workerHeader,
    "\tDuring handling of the above exception, another exception occurred:",
    "\tTraceback (most recent call last):",
    "\t  File \"worker.py\", line 20, in run",
    "\t    raise RuntimeError(\"failed\")",
    "\tRuntimeError: failed",
    "\t",
    workerHeader,
    "\t  independent print"
  ].join("\n"));
  assert.deepEqual(taskLogEntries(lines).map((entry) => entry.length), [11, 1]);
  assert.ok(lines.slice(0, -1).every((line) => line.level === "ERROR"));
  assert.equal(lines.at(-1).level, null);
  assert.equal(lines.at(-1).format, "plain");
});

test("worker-only indentation after a completed traceback is not proof of continuation", () => {
  const lines = parseTaskLog([...traceback, "", "  independent print"].join("\n"));
  assert.equal(lines.at(-1).level, null);
  assert.equal(lines.at(-1).continuation, false);
  assert.equal(taskLogEntries(lines).length, 2);
});

test("original colored bracket and standard Loguru formats retain metadata and levels", () => {
  const escape = String.fromCharCode(27);
  const color = (code, value) => `${escape}[${code}m${value}${escape}[0m`;
  const lines = parseTaskLog([
    `${color(32, timestamp)} [ ${color(34, "DEBUG")} ] ${color(36, "worker.py")} | ${color(36, "run")}: 12行| ${color(34, "debug details")}`,
    `${color(32, timestamp)} | ${color(31, "ERROR")} | ${color(36, "worker:run:20")} - ${color(31, "failed")}`,
    `${color(32, timestamp)} | ${color(33, "WARNING")} | warning without a source`
  ].join("\r\n"));
  assert.deepEqual(lines.map((line) => line.level), ["DEBUG", "ERROR", "WARNING"]);
  assert.deepEqual(lines.map((line) => line.format), ["loguru", "loguru", "loguru"]);
  assert.equal(lines[0].file, "worker.py");
  assert.equal(lines[0].functionName, "run");
  assert.equal(lines[0].sourceLine, 12);
  assert.equal(lines[0].timestamp, timestamp);
  assert.equal(lines[0].message, "debug details");
  assert.equal(lines[1].file, "worker");
  assert.equal(lines[1].sourceLine, 20);
  assert.equal(lines[1].message, "failed");
  assert.equal(lines[2].source, null);
  assert.ok(lines.every((line) => !line.raw.includes(escape)));
  assert.deepEqual(filterTaskLog(lines, "INFO"), [lines[1], lines[2]]);
});
