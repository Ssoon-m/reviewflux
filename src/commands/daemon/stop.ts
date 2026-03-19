import { spawnSync } from "node:child_process";
import { promptText } from "../../cli/clack-prompter";
type RunningDaemonProcess = {
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

function parsePid(raw: string): number {
  const trimmed = raw.trim();
  const pid = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    throw new Error(`invalid_pid:${raw}`);
  }
  return pid;
}

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

function findRunningDaemonProcessesForStop(): RunningDaemonProcess[] {
  return collectProcessesForTree()
    .filter((entry) => isReviewFluxDaemonLine(entry.command))
    .sort((a, b) => a.pid - b.pid);
}

function pickRootDaemons(processes: RunningDaemonProcess[]): RunningDaemonProcess[] {
  const daemonPids = new Set(processes.map((process) => process.pid));
  return processes.filter((process) => !daemonPids.has(process.ppid)).sort((a, b) => a.pid - b.pid);
}

function resolvePidFromArgOrPrompt(rawPid?: string): Promise<number> {
  if (rawPid != null && rawPid.trim().length > 0) {
    return Promise.resolve(parsePid(rawPid));
  }

  return promptText({
    message: "Daemon PID",
    placeholder: "e.g. 12345",
  }).then((raw) => parsePid(raw));
}

function collectProcessesForTree(): RunningDaemonProcess[] {
  const user = process.env.USER ?? process.env.LOGNAME ?? process.env.USERNAME;
  const args = user ? ["-u", user, "-eo", "pid=,ppid=,args="] : ["-eo", "pid=,ppid=,args="];
  const result = spawnSync("ps", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });

  if (result.status !== 0 || result.error) {
    if (result.error) throw result.error;
    const stderr = result.stderr?.toString().trim();
    throw new Error(`daemon_process_tree_unix_failed:${stderr || "ps_failed"}`);
  }

  return (result.stdout?.toString() ?? "")
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (!match) return undefined;
      const pid = Number.parseInt(match[1] ?? "", 10);
      const ppid = Number.parseInt(match[2] ?? "", 10);
      const command = (match[3] ?? "").trim();
      if (!Number.isFinite(pid) || !Number.isFinite(ppid) || !command) return undefined;
      return { pid, ppid, command };
    })
    .filter((entry): entry is RunningDaemonProcess => entry !== undefined);
}

function getDescendants(pid: number, allProcesses: RunningDaemonProcess[]): number[] {
  const childrenByParent = new Map<number, number[]>();
  for (const process of allProcesses) {
    const list = childrenByParent.get(process.ppid) ?? [];
    list.push(process.pid);
    childrenByParent.set(process.ppid, list);
  }

  const descendants: number[] = [];
  const queue: number[] = [pid];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current == null) continue;
    const children = childrenByParent.get(current) ?? [];
    for (const child of children) {
      descendants.push(child);
      queue.push(child);
    }
  }

  return descendants;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    return false;
  }
}

function killUnixProcessTree(rootPid: number): void {
  const allProcesses = collectProcessesForTree();
  const descendants = getDescendants(rootPid, allProcesses).filter((candidate) => candidate !== rootPid);

  const toKill = [...descendants, rootPid].reverse();
  for (const pid of toKill) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // ignore
    }
  }

  const remaining = toKill.filter(isPidAlive);
  for (const pid of remaining) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ignore
    }
  }
}

function killWindowsProcessTree(rootPid: number): void {
  const code = spawnSync("taskkill", ["/T", "/F", "/PID", `${rootPid}`], {
    encoding: "utf8",
  }).status;
  if (code !== 0) {
    throw new Error(`daemon_stop_windows_failed:${code}`);
  }
}

export async function runDaemonStopCommand(rawPid?: string): Promise<void> {
  const runningDaemons = findRunningDaemonProcessesForStop();
  if (runningDaemons.length === 0) {
    console.log("[reviewflux] no running daemon processes found.");
    return;
  }

  let pid: number;
  try {
    pid = await resolvePidFromArgOrPrompt(rawPid);
  } catch {
    console.log("[reviewflux] invalid daemon PID. try numeric PID from `rvw daemon list`.");
    return;
  }

  const target = runningDaemons.find((entry) => entry.pid === pid);
  if (!target) {
    console.log(`[reviewflux] daemon pid not found: ${pid}`);
    console.log("[reviewflux] run `rvw daemon list` and choose a PID from the result.");
    return;
  }

  const runningRoots = pickRootDaemons(runningDaemons);
  const isRoot = runningRoots.some((entry) => entry.pid === pid);
  if (!isRoot) {
    console.log(
      `[reviewflux] warning: pid ${pid} is not a root daemon process. attempting to stop its process tree directly.`,
    );
  }

  if (process.platform === "win32") {
    killWindowsProcessTree(target.pid);
  } else {
    killUnixProcessTree(target.pid);
  }

  console.log(`[reviewflux] stopped daemon pid=${target.pid}`);
}
