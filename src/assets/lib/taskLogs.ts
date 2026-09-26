export type TaskLogLevel = "TRACE" | "DEBUG" | "INFO" | "SUCCESS" | "WARNING" | "ERROR" | "CRITICAL" | "SYSTEM";
export type TaskLogFormat = "dolphinscheduler" | "loguru" | "traceback" | "plain";

export type ParsedTaskLogLine = {
  file: string | null;
  format: TaskLogFormat;
  functionName: string | null;
  level: TaskLogLevel | null;
  lineNumber: number;
  message: string;
  outerTimestamp: string | null;
  raw: string;
  source: string | null;
  sourceLine: number | null;
  timestamp: string | null;
};

export type TaskLogGroup = {
  key: string;
  lines: ParsedTaskLogLine[];
  title: string | null;
};

const TIMESTAMP_PATTERN = String.raw`\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?`;
const DOLPHINSCHEDULER_LINE = new RegExp(
  String.raw`^\s*\[([A-Z]+)\]\s+(${TIMESTAMP_PATTERN})(?:\s+([+-]\d{4}))?\s+(.*)$`
);
const LOGURU_BRACKET_LINE = new RegExp(
  String.raw`^\s*(${TIMESTAMP_PATTERN})\s+\[\s*([A-Z]+)\s*\]\s+([^|\r\n]+?)\s*\|\s*([^|\r\n]+?):\s*(\d+)行\|\s?(.*)$`
);
const LOGURU_STANDARD_LINE = new RegExp(
  String.raw`^\s*(${TIMESTAMP_PATTERN})\s*\|\s*([A-Z]+)\s*\|\s*(.*?)\s+-\s?(.*)$`
);
const LOG_PATH_LINE = /^\s*\[LOG-PATH\]:\s*(.*?),\s*\[HOST\]:\s*(.*?)\s*$/;
const TRACEBACK_START = /^\s*Traceback \(most recent call last\):\s*$/;
const TRACEBACK_FILE = /^\s*File ".+", line \d+(?:, in .+)?\s*$/;
const TRACEBACK_END = /^\s*(?:[\w.]+(?:Error|Exception|Interrupt|Exit)|KeyboardInterrupt)(?::.*)?\s*$/;
const SECTION_BORDER = /^\*{20,}$/;
const SECTION_TITLE = /^\*{5,}\s+(.+?)\s+\*{5,}$/;

export function parseTaskLog(message: string): ParsedTaskLogLine[] {
  const lines = splitLogLines(message);
  let traceback = false;

  return lines.map((raw, index) => {
    const parsed = parseDirectLine(raw, index + 1);
    const content = parsed.message;

    if (TRACEBACK_START.test(content)) traceback = true;
    if (traceback || TRACEBACK_FILE.test(content) || TRACEBACK_END.test(content)) {
      const result: ParsedTaskLogLine = {
        ...parsed,
        format: "traceback",
        level: "ERROR"
      };
      if (TRACEBACK_END.test(content)) traceback = false;
      return result;
    }

    return parsed;
  });
}

export function appendTaskLog(current: string, next: string, preservePageBoundary = false) {
  if (preservePageBoundary) {
    if (!current || !next || current.endsWith("\n")) return current + next;
    return `${current}\n${next}`;
  }
  if (!current || !next || current.endsWith("\n") || next.startsWith("\n")) return current + next;
  return `${current}\n${next}`;
}

export function shouldResetTerminalTaskLog(scope: "full" | "worker", terminal: boolean) {
  return terminal && scope === "full";
}

export function groupTaskLogSections(lines: ParsedTaskLogLine[]): TaskLogGroup[] {
  const headers = lines.flatMap((line, index) => {
    const title = line.message.trim().match(SECTION_TITLE)?.[1]?.trim();
    const previousIsBorder = SECTION_BORDER.test(lines[index - 1]?.message.trim() ?? "");
    const nextIsBorder = SECTION_BORDER.test(lines[index + 1]?.message.trim() ?? "");
    if (!title || !previousIsBorder && !nextIsBorder) return [];
    return [{
      contentStart: nextIsBorder ? index + 2 : index + 1,
      headerStart: previousIsBorder ? index - 1 : index,
      title
    }];
  });
  if (!headers.length) return lines.length ? [{ key: "plain-0", lines, title: null }] : [];

  const groups: TaskLogGroup[] = [];
  let cursor = 0;
  headers.forEach((header, index) => {
    if (cursor < header.headerStart) {
      groups.push({
        key: `section-log-information-${lines[cursor].lineNumber}`,
        lines: lines.slice(cursor, header.headerStart),
        title: "Log Information"
      });
    }
    const nextHeaderStart = headers[index + 1]?.headerStart ?? lines.length;
    appendSectionGroups(
      groups,
      lines,
      header.title,
      header.contentStart,
      nextHeaderStart
    );
    cursor = nextHeaderStart;
  });
  return groups;
}

function appendSectionGroups(
  groups: TaskLogGroup[],
  lines: ParsedTaskLogLine[],
  parentTitle: string,
  start: number,
  end: number
) {
  const pairs = pairedSectionMarkers(lines, start, end);
  if (!pairs.length) {
    appendGroup(groups, lines, parentTitle, start, end);
    return;
  }

  let cursor = start;
  pairs.forEach((pair) => {
    appendGroup(groups, lines, parentTitle, cursor, pair.opening);
    appendGroup(groups, lines, pair.title, pair.opening + 1, pair.closing);
    cursor = pair.closing + 1;
  });
  appendGroup(
    groups,
    lines,
    pairs.some((pair) => pair.title === "Script Content") ? "Task Output" : parentTitle,
    cursor,
    end
  );
}

function pairedSectionMarkers(lines: ParsedTaskLogLine[], start: number, end: number) {
  const openings = new Map<string, number>();
  const pairs: Array<{ closing: number; opening: number; title: string }> = [];
  for (let index = start; index < end; index += 1) {
    const title = lines[index].message.trim().match(SECTION_TITLE)?.[1]?.trim();
    if (!title) continue;
    const opening = openings.get(title);
    if (opening === undefined) {
      openings.set(title, index);
      continue;
    }
    pairs.push({ closing: index, opening, title });
    openings.delete(title);
  }
  return pairs;
}

function appendGroup(
  groups: TaskLogGroup[],
  lines: ParsedTaskLogLine[],
  title: string,
  start: number,
  end: number
) {
  if (start >= end) return;
  groups.push({
    key: `section-${title}-${lines[start].lineNumber}`,
    lines: lines.slice(start, end),
    title
  });
}

function parseDirectLine(raw: string, lineNumber: number): ParsedTaskLogLine {
  const logPath = raw.match(LOG_PATH_LINE);
  if (logPath) {
    return createLine(raw, lineNumber, {
      format: "dolphinscheduler",
      level: "SYSTEM",
      message: logPath[1],
      source: logPath[2] ? `Worker ${logPath[2].trim()}` : "DolphinScheduler"
    });
  }

  const dolphinScheduler = raw.match(DOLPHINSCHEDULER_LINE);
  if (dolphinScheduler) {
    const [, rawLevel, timestamp, timezone, remainder] = dolphinScheduler;
    const { message, source } = splitDolphinSchedulerRemainder(remainder);
    const innerContent = message.replace(/^\s*->\s*/, "");
    const inner = parseLoguruLine(innerContent, raw, lineNumber);
    if (inner) {
      return {
        ...inner,
        outerTimestamp: `${timestamp}${timezone ? ` ${timezone}` : ""}`
      };
    }
    return createLine(raw, lineNumber, {
      format: "dolphinscheduler",
      level: normalizeTaskLogLevel(rawLevel),
      message: message.trim() === "->" ? "子进程输出" : message,
      source: source || "DolphinScheduler",
      timestamp: `${timestamp}${timezone ? ` ${timezone}` : ""}`
    });
  }

  return parseLoguruLine(raw, raw, lineNumber) ?? createLine(raw, lineNumber, { message: raw });
}

function parseLoguruLine(content: string, raw: string, lineNumber: number): ParsedTaskLogLine | null {
  const bracket = content.match(LOGURU_BRACKET_LINE);
  if (bracket) {
    const [, timestamp, rawLevel, file, functionName, sourceLine, message] = bracket;
    return createLine(raw, lineNumber, {
      file: file.trim(),
      format: "loguru",
      functionName: functionName.trim(),
      level: normalizeTaskLogLevel(rawLevel),
      message,
      source: `${file.trim()} · ${functionName.trim()}:${sourceLine}`,
      sourceLine: Number(sourceLine),
      timestamp
    });
  }

  const standard = content.match(LOGURU_STANDARD_LINE);
  if (!standard) return null;
  const [, timestamp, rawLevel, source, message] = standard;
  const sourceParts = parseStandardLoguruSource(source.trim());
  return createLine(raw, lineNumber, {
    ...sourceParts,
    format: "loguru",
    level: normalizeTaskLogLevel(rawLevel),
    message,
    source: source.trim() || null,
    timestamp
  });
}

function splitDolphinSchedulerRemainder(value: string) {
  if (value.startsWith("-")) return { message: value.slice(1).trimStart(), source: null };
  const separator = value.indexOf(" - ");
  if (separator < 0) return { message: value, source: null };
  return {
    message: value.slice(separator + 3),
    source: value.slice(0, separator).trim() || null
  };
}

function normalizeTaskLogLevel(value: string): TaskLogLevel {
  const normalized = value.trim().toUpperCase();
  if (normalized === "WARN") return "WARNING";
  if (normalized === "FATAL") return "CRITICAL";
  if (["TRACE", "DEBUG", "INFO", "SUCCESS", "WARNING", "ERROR", "CRITICAL"].includes(normalized)) {
    return normalized as TaskLogLevel;
  }
  return "SYSTEM";
}

function createLine(
  raw: string,
  lineNumber: number,
  value: Partial<Omit<ParsedTaskLogLine, "lineNumber" | "raw">> & Pick<ParsedTaskLogLine, "message">
): ParsedTaskLogLine {
  return {
    file: value.file ?? null,
    format: value.format ?? "plain",
    functionName: value.functionName ?? null,
    level: value.level ?? null,
    lineNumber,
    message: value.message,
    outerTimestamp: value.outerTimestamp ?? null,
    raw,
    source: value.source ?? null,
    sourceLine: value.sourceLine ?? null,
    timestamp: value.timestamp ?? null
  };
}

function parseStandardLoguruSource(value: string) {
  const match = value.match(/^(.*?):([^:]+):(\d+)$/);
  if (!match) return {};
  return {
    file: match[1].trim(),
    functionName: match[2].trim(),
    sourceLine: Number(match[3])
  };
}

function splitLogLines(message: string) {
  if (!message) return [];
  const lines = message.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r\n?/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}
