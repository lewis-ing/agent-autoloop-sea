// 打出一个单文件可执行程序：esbuild 把程序打成一个 CommonJS 文件，Node 的 SEA 把它注入一份复制出来的 node。
// 平台之间不能交叉编译，每个平台都得在自己的机器上跑这一次。
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stablePath } from "../host/node-path.ts";

const root = path.join(import.meta.dirname, "..");
const work = path.join(root, "build");
const dist = path.join(root, "dist");
mkdirSync(work, { recursive: true });
mkdirSync(dist, { recursive: true });

// 单文件版里没有"程序所在的目录"：import.meta 换成本进程的目录和文件。
const meta = {
  name: "sea-meta",
  setup(b: any) {
    b.onLoad({ filter: /\.ts$/ }, async (args: { path: string }) => {
      const src = readFileSync(args.path, "utf8");
      return {
        contents: src
          .replaceAll("import.meta.dirname", "__seaDir")
          .replaceAll("import.meta.url", "__seaUrl")
          .replaceAll("import.meta.main", "__seaMain"),
        loader: "ts",
      };
    });
  },
};

// 磁盘上没有 plugins 目录时，内置插件在构建时一次列齐；源码版仍按目录找，自己加的插件优先。
const kinds = ["agent", "channel", "source"];
const listed = readdirSync(path.join(root, "plugins"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) =>
    kinds
      .filter((kind) => existsSync(path.join(root, "plugins", entry.name, `${kind}.ts`)))
      .map((kind) => `  ${JSON.stringify(`${entry.name}/${kind}`)}: () => import(${JSON.stringify(`../plugins/${entry.name}/${kind}.ts`)}),`),
  )
  .join("\n");
const bundledPlugins = `// 构建时生成：单文件版读不到磁盘上的插件目录，内置的在这里一次列齐。
const registry: Record<string, () => Promise<any>> = {
${listed}
};

export async function loadPlugin(name: string, kind: "agent" | "channel" | "source") {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(\`插件名字不正确：\${name}\`);
  const load = registry[\`\${name}/\${kind}\`];
  if (!load) throw new Error(\`没有 \${name} 的插件（\${kind}）\`);
  return (await load()).default;
}
`;

// 运行时读不到自己的源码和仓库，这两件事在构建时算好。
const commit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const release = execFileSync("git", ["-C", root, "tag", "--points-at", "HEAD"], { encoding: "utf8" })
  .split("\n")
  .find((tag) => /^v\d+\.\d+\.\d+/.test(tag));
const sources = ["kernel/evolve.ts", "kernel/credentials.ts"]
  .map((file) => readFileSync(path.join(root, file), "utf8"))
  .join("\n");

await build({
  entryPoints: [path.join(root, "bin", "agent-autoloop.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  outfile: path.join(work, "agent-autoloop.cjs"),
  banner: {
    js: `const __seaDir=__dirname;const __seaUrl=require("node:url").pathToFileURL(__filename).href;const __seaMain=require.main===module;`,
  },
  define: {
    __SEA__: "true",
    __SEA_COMMIT__: JSON.stringify(commit),
    __SEA_SOURCES__: JSON.stringify(sources),
    __SEA_RELEASE__: JSON.stringify(release ?? null),
  },
  // The loader is replaced before the source is rewritten, or the rewrite claims the file first.
  plugins: [
    { name: "sea-plugins", setup(b: any) {
      b.onLoad({ filter: /host[\\/]plugins\.ts$/ }, () => ({ contents: bundledPlugins, loader: "ts" }));
    } },
    meta,
  ],
  logLevel: "warning",
});

const exe = path.join(dist, `agent-autoloop-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`);
writeFileSync(
  path.join(work, "sea-config.json"),
  JSON.stringify({ main: "./agent-autoloop.cjs", output: "./sea-prep.blob", disableExperimentalSEAWarning: true }),
);
execFileSync(process.execPath, ["--experimental-sea-config", "sea-config.json"], { cwd: work, stdio: "inherit" });
// A copy of node that is still running cannot be replaced on Windows; the old one is taken away first.
rmSync(exe, { force: true });
cpSync(stablePath(process.execPath), exe);
execFileSync(
  process.execPath,
  [
    path.join(root, "node_modules", "postject", "dist", "cli.js"),
    exe,
    "NODE_SEA_BLOB",
    path.join(work, "sea-prep.blob"),
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ],
  { stdio: "inherit" },
);
console.log(`${exe}（提交 ${commit.slice(0, 12)}${release ? `，${release}` : ""}）`);
