import { spawnSync } from "node:child_process";

export type RunningDaemonProcess = {
  pid: number;
  ppid: number;
  command: string;
};

const DAEMON_START_RE = /\bdaemon\s+start\b/i;
const REVIEWFLUX_BINARY_HINTS = [
  /(?:^|\s)(?:rvw|reviewflux)(?:\s|$)/i,
  /dist[\\/](?:cli[\\/])?index\.mjs\b/i,
  /scripts[\\/]run-node\.mjs\b/i,
];

function splitCommandTokens(line: string): string[] {
  const raw = line.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
  return (raw ?? []).map((token) => token.replace(/^['"]|['"]$/g, ""));
}

function findReviewFluxCommandIndex(tokens: string[]): number {
  return tokens.findIndex((token) => {
    const lowered = token.toLowerCase();
    if (lowered === "rvw" || lowered === "reviewflux") return true;
    if (lowered === "node" || lowered === "pnpm") return false;
    if (lowered.includes("dist/cli/index.mjs") || lowered.includes("dist\\cli\\index.mjs")) return true;
    return lowered.includes("scripts/run-node.mjs") || lowered.includes("scripts\\run-node.mjs");
  });
}

function isReviewFluxDaemonLine(line: string): boolean {
  if (!DAEMON_START_RE.test(line)) return false;
  if (!REVIEWFLUX_BINARY_HINTS.some((hint) => hint.test(line))) return false;

  const tokens = splitCommandTokens(line);
  const commandIndex = findReviewFluxCommandIndex(tokens);
  if (commandIndex < 0) return false;

  const next = tokens[commandIndex + 1]?.toLowerCase() === "daemon";
  const nextNext = tokens[commandIndex + 2]?.toLowerCase() === "start";
  return next && nextNext;
}

function parsePidCommand(line: string): RunningDaemonProcess | undefined {
  const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
  if (!match) return undefined;

  const pid = Number.parseInt(match[1] ?? "", 10);
  const ppid = Number.parseInt(match[2] ?? "", 10);
  const command = (match[3] ?? "").trim();
  if (!Number.isFinite(pid) || !Number.isFinite(ppid) || !command) return undefined;
  if (!isReviewFluxDaemonLine(command)) return undefined;

  return { pid, ppid, command };
}

function dedupeProcesses(entries: RunningDaemonProcess[]): RunningDaemonProcess[] {
  const byPid = new Map<number, RunningDaemonProcess>();
  for (const entry of entries) {
    byPid.set(entry.pid, entry);
  }
  return [...byPid.values()];
}

function listDaemonProcessesAll(): RunningDaemonProcess[] {
  if (process.platform === "win32") {
    return listDaemonProcessesFromWindows();
  }
  return listDaemonProcessesFromPs();
}

function listDaemonProcessesFromPs(): RunningDaemonProcess[] {
  const user = process.env.USER ?? process.env.LOGNAME ?? process.env.USERNAME;
  const args = user ? ["-u", user, "-eo", "pid=,ppid=,args="] : ["-eo", "pid=,ppid=,args="];

  const result = spawnSync("ps", args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim();
    throw new Error(`daemon_list_unix_failed:${stderr || "ps_failed"}`);
  }

  const output = result.stdout?.toString() ?? "";
  return dedupeProcesses(
    output
      .split(/\r?\n/)
      .map(parsePidCommand)
      .filter((entry): entry is RunningDaemonProcess => entry !== undefined),
  );
}

function listDaemonProcessesFromWindows(): RunningDaemonProcess[] {
  const result = spawnSync(
    "wmic",
    ["process", "get", "Name,ParentProcessId,ProcessId,CommandLine", "/FORMAT:list"],
    {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim();
    throw new Error(`daemon_list_windows_failed:${stderr || "wmic_failed"}`);
  }

  const blocks = (result.stdout?.toString() ?? "").split(/\r?\n\r?\n/);
  const records: RunningDaemonProcess[] = [];

  for (const block of blocks) {
    const pidLine = block.split(/\r?\n/).find((line) => line.startsWith("ProcessId="));
    const ppidLine = block.split(/\r?\n/).find((line) => line.startsWith("ParentProcessId="));
    const commandLine = block.split(/\r?\n/).find((line) => line.startsWith("CommandLine="));
    if (!pidLine || !ppidLine || !commandLine) continue;

    const pid = Number.parseInt(pidLine.slice("ProcessId=".length), 10);
    const ppid = Number.parseInt(ppidLine.slice("ParentProcessId=".length), 10);
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;

    const command = commandLine.slice("CommandLine=".length).trim();
    if (!isReviewFluxDaemonLine(command)) continue;

    records.push({ pid, ppid, command });
  }

  return dedupeProcesses(records);
}

function pickRootDaemons(processes: RunningDaemonProcess[]): RunningDaemonProcess[] {
  const daemonPids = new Set(processes.map((process) => process.pid));
  const roots = processes.filter((process) => !daemonPids.has(process.ppid));
  return roots.sort((a, b) => a.pid - b.pid);
}

function padRight(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : `${value}${" ".repeat(width - value.length)}`;
}

export function findRunningDaemonProcesses(): RunningDaemonProcess[] {
  return pickRootDaemons(listDaemonProcessesAll());
}

export async function runDaemonListCommand(): Promise<void> {
  let daemons: RunningDaemonProcess[];
  try {
    daemons = findRunningDaemonProcesses();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    console.log(`[reviewflux] daemon list is not available: ${detail}`);
    return;
  }

  if (daemons.length === 0) {
    console.log("[reviewflux] no running daemon processes found.");
    return;
  }

  const rows = daemons.map((daemon) => ({
    pid: daemon.pid.toString(),
  }));

  const pidWidth = Math.max(3, ...rows.map((row) => row.pid.length));
  const statusWidth = 8;
  const sep = `+${"-".repeat(pidWidth + 2)}+${"-".repeat(statusWidth + 2)}+`;

  console.log("\n[reviewflux] running daemons:");
  console.log(sep);
  console.log(`| ${padRight("PID", pidWidth)} | ${padRight("STATUS", statusWidth)} |`);
  console.log(sep);
  for (const row of rows) {
    console.log(`| ${padRight(row.pid, pidWidth)} | ${padRight("running", statusWidth)} |`);
  }
  console.log(sep);
  console.log(`\nTip: stop a daemon by PID: rvw daemon stop <PID>`);
}
