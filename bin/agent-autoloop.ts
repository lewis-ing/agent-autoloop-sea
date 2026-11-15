#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// This program is also its own child: a worker's turn, the ACP bridge and the delivery each start it with a hidden
// first argument naming what to do. Everything else is the command line.
const children: Record<string, () => Promise<unknown>> = {
  "__sea:run": () => import("../worker/run.ts"),
  "__sea:bridge": () => import("../plugins/acp/bridge.ts"),
  "__sea:delivery": () => import("../plugins/delivery/run.ts"),
};
const asked = process.argv[2];
const load = asked ? children[asked] : undefined;
if (load) {
  process.argv.splice(2, 1);
  process.env.AGENT_AUTOLOOP_SEA_CHILD = asked;
  void load().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  void import("../cli/main.ts").catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
