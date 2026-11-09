#!/usr/bin/env node
// Clock Guard_Hook (R2.2–R2.6). Runs as a Kiro PreToolUse hook on agent file writes.
// Reads the hook event JSON on stdin and decides from the tool input alone: it never opens the target file.
//   exit 0: allowed (no wall-clock read in the new content, or the target is an allow-listed Clock_Port file)
//   exit 2: blocked (wall-clock read outside the allow-list, or the write could not be checked)
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DATE_NOW_TEXT, containsDateNow, loadAllowList, toRepoPath } from "./clock-check.mjs";

const PATH_KEYS = ["path", "file_path", "filePath", "targetFile", "target_file"];
const CONTENT_KEYS = ["text", "newStr", "new_str", "content", "contents", "new_string", "newString"];
const INPUT_KEYS = ["tool_input", "toolInput", "input", "arguments", "args", "parameters"];

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Finds the tool input object in the hook event; falls back to the event itself. */
export function toolInputOf(event) {
  for (const key of INPUT_KEYS) {
    let value = event[key];
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        continue;
      }
    }
    if (isObject(value)) return value;
  }
  return event;
}

/** Pure decision: returns { code, message }. */
export function decide(rawStdin, allowList) {
  let event;
  try {
    event = JSON.parse(rawStdin);
  } catch {
    return { code: 2, message: "clock guard: could not parse the hook input as JSON, so the write could not be checked." };
  }
  if (!isObject(event)) {
    return { code: 2, message: "clock guard: the hook input is not a JSON object, so the write could not be checked." };
  }
  const input = toolInputOf(event);
  const target = PATH_KEYS.map((k) => input[k]).find((v) => typeof v === "string" && v.trim() !== "");
  if (target === undefined) {
    return { code: 2, message: "clock guard: no target file path in the tool input, so the write could not be checked." };
  }
  const supplied = CONTENT_KEYS.map((k) => input[k]).filter((v) => typeof v === "string");
  if (!supplied.some(containsDateNow)) return { code: 0, message: "" };

  const file = toRepoPath(target);
  if (allowList.includes(file)) return { code: 0, message: "" };
  return {
    code: 2,
    message:
      `clock guard: blocked a write to ${file} because it adds ${DATE_NOW_TEXT}). ` +
      `Read time through the Clock_Port instead. Only these files may read the wall clock: ${allowList.join(", ")}.`,
  };
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let result;
  try {
    result = decide(await readStdin(), loadAllowList());
  } catch (error) {
    result = { code: 2, message: `clock guard: the write could not be checked (${error instanceof Error ? error.message : String(error)}).` };
  }
  if (result.message) process.stderr.write(result.message + "\n");
  process.exit(result.code);
}
