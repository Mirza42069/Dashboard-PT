/**
 * Frees the dev ports before starting.
 *
 * `bun run --filter '*' dev` spawns child processes that do not always die with
 * Ctrl+C on Windows, so a previous run can keep listening on 3001 while the new
 * one only manages to claim 3000. That leaves the web app, marketing site, and API running
 * different revisions of the code — which looks like a caching bug rather than
 * a stale process, and costs far more time than it should.
 *
 * Runs automatically via the `predev` script. Only kills whatever is listening
 * on these exact ports; nothing else is touched.
 */
const PORTS = [3000, 3001, 3002];

async function pidsOnPort(port: number): Promise<number[]> {
  const isWindows = process.platform === "win32";
  const cmd = isWindows
    ? ["powershell", "-NoProfile", "-Command",
       `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`]
    : ["lsof", "-ti", `tcp:${port}`, "-sTCP:LISTEN"];

  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;

  return [...new Set(out.split(/\r?\n/).map((l) => Number(l.trim())).filter((n) => Number.isInteger(n) && n > 0))];
}

for (const port of PORTS) {
  for (const pid of await pidsOnPort(port)) {
    // Never take out the process doing the killing.
    if (pid === process.pid) continue;
    try {
      process.kill(pid, "SIGKILL");
      console.log(`freed port ${port} (killed pid ${pid})`);
    } catch {
      console.warn(`could not free port ${port}: pid ${pid} refused to die — kill it manually`);
    }
  }
}
