// A Windows turn outlives its worker. Its supervisor owns the process tree; this child preserves output and the exit code.
import { spawn } from "node:child_process";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { commandLine, POWERSHELL } from "../host/command.ts";

// A job object keeps the turn's whole tree in one Windows job, so closing the supervisor closes every Agent too. It is
// written out for the turn because the single executable has no folder of its own to keep a script in.
const WINDOWS_JOB = `# A job object keeps every descendant in the turn, including after its immediate parent exits. Closing the supervisor
# kills the whole job, so cancelling a turn or a crashed supervisor cannot leave an Agent running by itself.
param([string]$RunFile, [string]$Marker)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class TurnJob {
    [StructLayout(LayoutKind.Sequential)]
    struct Limits {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimits {
        public Limits Basic;
        public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, uint size);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")]
    static extern IntPtr GetCurrentProcess();
    static IntPtr job;
    public static void Own() {
        job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Win32Exception();
        var limits = new ExtendedLimits();
        limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits))) throw new Win32Exception();
        if (!AssignProcessToJobObject(job, GetCurrentProcess())) throw new Win32Exception();
    }
}
'@
[TurnJob]::Own()
$node = $env:AGENT_AUTOLOOP_NODE
$entry = $env:AGENT_AUTOLOOP_ENTRY
if ($entry) { & $node $entry __sea:run $RunFile } else { & $node __sea:run $RunFile }
exit $LASTEXITCODE
`;

if (process.argv[2] === "--supervise") {
  // PowerShell cannot run detached; Node can. Its non-detached child is kept in Node's Windows job, so killing this
  // supervisor also closes PowerShell's job and its entire Agent tree.
  const script = path.join(tmpdir(), `agent-autoloop-${process.pid}.ps1`);
  writeFileSync(script, WINDOWS_JOB, "utf8");
  const child = spawn(
    POWERSHELL,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
      "-RunFile",
      process.argv[3],
      "-Marker",
      process.argv[4],
    ],
    { stdio: "inherit", windowsHide: true },
  );
  child.on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });
  child.on("exit", (code) => {
    rmSync(script, { force: true });
    process.exit(code ?? 1);
  });
} else {
  const { argv, cwd, exit } = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const publish = (code: number) => {
    writeFileSync(`${exit}.tmp`, String(code), { mode: 0o600 });
    renameSync(`${exit}.tmp`, exit);
  };
  // The command line Windows starts has a limit, and a long prompt passed on it reaches it; spawn may throw that at once.
  const said = (error: NodeJS.ErrnoException) =>
    error.code === "ENAMETOOLONG"
      ? `命令行太长：约 ${argv.join(" ").length} 个字符，Windows 最多 32767。` +
        "把规则里长的说明写进 Skill，提示词里只留一句加载它。"
      : error.message;
  try {
    const [program, args] = commandLine(argv);
    const child = spawn(program, args, { cwd, stdio: "inherit", windowsHide: true });
    child.on("error", (error) => {
      console.error(said(error));
      publish(127);
    });
    child.on("exit", (code) => publish(code ?? 1));
  } catch (error) {
    console.error(said(error as NodeJS.ErrnoException));
    publish(127);
  }
}
