// The delivery as an agent: its process is run.ts, and what it prints is read the way any plain command's output is.
import { stablePath } from "../../host/node-path.ts";
import { selfArgs } from "../../host/sea.ts";
import command from "../command/agent.ts";
import type { Adapter } from "../../worker/agents.ts";

export default {
  command: (turn) => [stablePath(process.execPath), ...selfArgs("__sea:delivery"), ...(turn.command ?? [])],
  read: command.read,
} satisfies Adapter;
