// Whether this is the single executable. The build sets __SEA__ to true; from source there is no such constant, and
// `typeof` keeps that from throwing. An executable has no app folder on disk and no plugins added at run time.
import path from "node:path";

declare const __SEA__: boolean | undefined;
export const SEA = typeof __SEA__ !== "undefined" ? __SEA__ : false;

/** This program itself: the executable, or the entry script a source checkout runs. */
export const SELF = SEA ? process.execPath : path.join(import.meta.dirname, "..", "bin", "agent-autoloop.ts");

/** Starting this program with arguments: a checkout needs its entry script in front, an executable does not. */
export const selfArgs = (...args: string[]): string[] => (SEA ? [...args] : [SELF, ...args]);
