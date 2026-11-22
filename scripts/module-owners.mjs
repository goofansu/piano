import { globSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const shared = /^(shared\/|server\/shared\/|web\/src\/(shared|hooks)\/|test\/shared\/)/;

function aliases(config) {
  const paths = JSON.parse(readFileSync(resolve(root, config), "utf8")).compilerOptions?.paths;
  return Object.entries(paths ?? {})
    .map(([pattern, [target]]) => ({
      prefix: pattern.replace(/\*$/, ""),
      wildcard: pattern.endsWith("*"),
      target: resolve(root, dirname(config), target),
    }))
    .sort((a, b) => b.prefix.length - a.prefix.length);
}
const webAliases = aliases("web/tsconfig.app.json");
const nodeAliases = aliases("tsconfig.json");

function canonical(path) {
  for (const candidate of [path, `${path}.ts`, `${path}.tsx`, `${path}/index.ts`]) {
    if (statSync(candidate, { throwIfNoEntry: false })?.isFile())
      return relative(root, realpathSync(candidate));
  }
}

function owner(file) {
  const [area, second, third] = file.split("/");
  if (area === "features") return `features/${second}`;
  if (area === "web" && second === "src" && third !== "components") return "web app";
  if (area === "server") return "server app";
  return area;
}

const files = globSync("{features,shared,server,web/src,test,scripts}/**/*.{ts,tsx,mjs}", {
  cwd: root,
  exclude: (name) => name === "node_modules",
});
const importers = new Map();
for (const file of files) {
  const web = file.startsWith("web/") || /^features\/[^/]+\/web\//.test(file);
  const source = readFileSync(resolve(root, file), "utf8");
  for (const [, specifier] of source.matchAll(/(?:from|import\(?)\s*["']([^"']+)["']/g)) {
    const bare = specifier.split(/[?#]/)[0];
    let target;
    if (bare.startsWith(".")) target = resolve(root, dirname(file), bare);
    else {
      const alias = [...(web ? webAliases : []), ...nodeAliases].find((a) =>
        a.wildcard ? bare.startsWith(a.prefix) : bare === a.prefix,
      );
      if (!alias) continue;
      target = alias.target.replace("*", bare.slice(alias.prefix.length));
    }
    const module = canonical(target);
    if (!module) continue;
    if (!importers.has(module)) importers.set(module, new Set());
    importers.get(module).add(file);
  }
}

function users(module, seen = new Set()) {
  const found = new Set();
  if (seen.has(module)) return found;
  seen.add(module);
  for (const importer of importers.get(module) ?? []) {
    if (shared.test(importer)) for (const user of users(importer, seen)) found.add(user);
    else found.add(owner(importer));
  }
  return found;
}

const owned = files
  .filter((file) => shared.test(file))
  .map((file) => ({ file, users: [...users(file)] }))
  .filter(({ users }) => users.length === 1 && users[0].startsWith("features/"));
for (const { file, users } of owned)
  console.error(`${file} is used only by ${users[0]}; move it into that feature`);
process.exitCode = owned.length ? 1 : 0;
