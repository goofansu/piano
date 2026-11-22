import { existsSync, globSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const within = (path, dir) => path === dir || path.startsWith(`${dir}${sep}`);
const sharedPackages = new Set(["effect", "@earendil-works/pi-schema", "zod"]);

function aliases(config) {
  const json = JSON.parse(readFileSync(config, "utf8"));
  if (json.extends || json.compilerOptions?.baseUrl)
    throw new Error(`Layer lint: resolve inheritance/baseUrl before using ${config}`);
  const paths = Object.entries(json.compilerOptions?.paths ?? {});
  if (paths.some(([pattern]) => pattern.includes("*") && !pattern.endsWith("*")))
    throw new Error(`Layer lint: unsupported alias pattern in ${config}`);
  return paths.map(([pattern, targets]) => ({
    prefix: pattern.replace(/\*$/, ""),
    wildcard: pattern.endsWith("*"),
    targets: targets.map((target) =>
      resolve(dirname(config), json.compilerOptions?.baseUrl ?? ".", target),
    ),
  }));
}
const serverAliases = aliases(resolve(root, "tsconfig.json"));
const webAliases = aliases(resolve(root, "web/tsconfig.app.json"));
const aliasOrder = (preferred, fallback) =>
  [...preferred, ...fallback].sort((a, b) => b.prefix.length - a.prefix.length);
const byRuntime = {
  web: aliasOrder(webAliases, serverAliases),
  node: aliasOrder(serverAliases, webAliases),
};

function canonical(path) {
  for (const candidate of [
    path,
    `${path}.ts`,
    `${path}.tsx`,
    `${path}.js`,
    `${path}/index.ts`,
    `${path}/index.tsx`,
  ]) {
    if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) return realpathSync(candidate);
  }
  return existsSync(path) ? realpathSync(path) : path;
}

function location(path) {
  const parts = relative(root, path).split(sep);
  const [area, second, third] = parts;
  if (parts.includes("node_modules") && area !== "..") return { kind: "package" };
  if (area === "features")
    return { kind: "feature", feature: second, runtime: third, rest: parts.slice(3).join("/") };
  if (area === "shared") return { kind: "shared", runtime: "contracts" };
  if (area === "server") return { kind: second === "shared" ? "shared" : "app", runtime: "server" };
  if (area === "web" && second === "src") {
    const common = third === "shared" || third === "components" || third === "hooks";
    return { kind: common ? "shared" : "app", runtime: "web" };
  }
  if (area === "test" && second === "shared") return { kind: "shared", runtime: "test" };
  return { kind: "other", area };
}

const entries = { server: ["index.ts"], web: ["index.ts", "browser.ts"] };
const isEntry = (module) =>
  module.kind === "feature" && (entries[module.runtime] ?? []).includes(module.rest);

function canImport(source, target) {
  if (target.kind === "package") return ["server", "extension", "test"].includes(source.runtime);
  if (target.kind === "other")
    return source.kind === "app" && source.runtime === "server" && target.area === "scripts";
  if (target.kind === "app" && source.kind !== "app") return false;
  if (target.kind === "feature" && source.feature !== target.feature) {
    if (source.kind !== "app" && source.kind !== "feature") return false;
    if (target.runtime !== "contracts" && !isEntry(target)) return false;
  }
  if (source.runtime === "test") return true;
  if (target.runtime === "contracts" || target.runtime === source.runtime) return true;
  return source.runtime === "extension" && target.runtime === "server";
}

function localPackage(specifier, importer) {
  const parts = specifier.split("/");
  const name = parts.splice(0, specifier.startsWith("@") ? 2 : 1).join("/");
  if (!name) return;
  for (const modules of createRequire(importer).resolve.paths(name) ?? []) {
    if (!within(modules, root)) continue;
    const linked = resolve(modules, name);
    if (!existsSync(linked)) continue;
    const directory = realpathSync(linked);
    if (within(directory, root) && !relative(root, directory).split(sep).includes("node_modules"))
      return resolve(directory, ...parts);
    break;
  }
}

const importMeta = (node) => node?.type === "MetaProperty" && node.meta.name === "import";
const member = (node) =>
  node?.type === "MemberExpression" && (node.computed ? node.property.value : node.property.name);
const literal = (source) =>
  typeof source?.value === "string"
    ? source.value
    : source?.type === "TemplateLiteral" && source.expressions.length === 0
      ? source.quasis[0].value.cooked
      : undefined;

const runtimes = new Set(["web", "server", "extension", "contracts", "test"]);

export default {
  meta: { name: "piano" },
  rules: {
    "no-html-tag-regex": {
      meta: {
        type: "problem",
        schema: [],
        messages: {
          tag: "Regex matching {{tag}} trips CodeQL js/bad-tag-filter; compare strings instead",
        },
      },
      create(context) {
        return {
          Literal(node) {
            const pattern = node.regex?.pattern.toLowerCase() ?? "";
            const tag = ["<script", "<\\/script", "<!--"].find((t) => pattern.includes(t));
            if (tag) context.report({ node, messageId: "tag", data: { tag } });
          },
        };
      },
    },
    "layer-imports": {
      meta: {
        type: "problem",
        schema: [],
        messages: { boundary: "{{reason}}: {{specifier}}" },
      },
      create(context) {
        const file = resolve(context.filename);
        const sourceModule = location(file);
        if (sourceModule.kind === "other" || sourceModule.kind === "package") return {};
        if (!runtimes.has(sourceModule.runtime)) {
          return {
            Program(node) {
              context.report({
                node,
                messageId: "boundary",
                data: {
                  reason: "Put feature modules in web, server, contracts, extension or test",
                  specifier: relative(root, file),
                },
              });
            },
          };
        }
        const report = (node, specifier, reason) =>
          context.report({ node, messageId: "boundary", data: { reason, specifier } });
        const entry = isEntry(sourceModule);
        function localTargets(bare) {
          const alias = (sourceModule.runtime === "web" ? byRuntime.web : byRuntime.node).find(
            (a) => (a.wildcard ? bare.startsWith(a.prefix) : bare === a.prefix),
          );
          return alias
            ? alias.targets.map((t) => t.replaceAll("*", () => bare.slice(alias.prefix.length)))
            : bare.startsWith(".") || isAbsolute(bare)
              ? [resolve(dirname(file), bare)]
              : [localPackage(bare, file)].filter(Boolean);
        }
        function allowed(node, specifier, path) {
          const target = canonical(path);
          if (canImport(sourceModule, location(target))) return true;
          report(
            node,
            specifier,
            `${relative(root, file)} cannot depend on ${relative(root, target)}`,
          );
          return false;
        }
        function check(node, source) {
          if (!source) return;
          const specifier = literal(source);
          if (specifier === undefined) {
            report(node, "<computed>", "Use a literal module specifier");
            return;
          }
          const bare = specifier.split(/[?#]/)[0];
          const targets = localTargets(bare);
          if (!targets.length) {
            if (sourceModule.runtime === "contracts" && !sharedPackages.has(specifier))
              report(
                node,
                specifier,
                "Shared external entry points require environment-neutral review",
              );
            if (sourceModule.runtime === "web" && isBuiltin(bare))
              report(node, specifier, "Browser modules cannot depend on a Node builtin");
            if (specifier.startsWith("#") || specifier.startsWith("file:"))
              report(node, specifier, "Use a relative path or a tsconfig alias for local modules");
            return;
          }
          for (const target of targets) if (!allowed(node, specifier, target)) break;
        }
        function checkGlob(node, source) {
          const pattern = literal(source);
          if (pattern === undefined) {
            report(node, "<computed>", "Use literal import.meta.glob patterns");
            return;
          }
          if (pattern.startsWith("!")) return;
          const magic = pattern.search(/[?*{[(]/);
          const split = magic < 0 ? pattern.length : pattern.lastIndexOf("/", magic) + 1;
          const prefix = pattern.slice(0, split),
            tail = pattern.slice(split);
          const targets = prefix.startsWith("/")
            ? [resolve(root, "web", "." + prefix)]
            : localTargets(prefix);
          if (!targets.length || tail.includes("..")) {
            report(node, pattern, "Anchor the glob inside its owning module directory");
            return;
          }
          for (const base of targets) {
            if (!allowed(node, pattern, base)) return;
            if (tail && existsSync(base)) {
              for (const path of globSync(tail, { cwd: base }))
                if (!allowed(node, pattern, resolve(base, path))) return;
            }
          }
        }
        return {
          Program(node) {
            if (!entry) return;
            for (const statement of node.body)
              if (
                statement.type !== "ExportAllDeclaration" &&
                !(statement.type === "ExportNamedDeclaration" && statement.source)
              )
                report(
                  statement,
                  relative(root, file),
                  "A feature entry file only re-exports the feature's modules",
                );
          },
          ImportDeclaration: (node) => check(node, node.source),
          ExportNamedDeclaration: (node) => check(node, node.source),
          ExportAllDeclaration: (node) => check(node, node.source),
          ImportExpression: (node) => check(node, node.source),
          TSImportType: (node) => check(node, node.source),
          TSExternalModuleReference: (node) => check(node, node.expression),
          CallExpression: (node) => {
            const callee = node.callee,
              source = node.arguments[0];
            if (member(callee) === "glob" && importMeta(callee.object)) {
              const patterns = source?.type === "ArrayExpression" ? source.elements : [source];
              for (const pattern of patterns) checkGlob(node, pattern);
            } else if (
              (callee.type === "Identifier" && callee.name === "require") ||
              (member(callee) === "require" && callee.object.name === "module") ||
              (member(callee) === "resolve" &&
                (callee.object.name === "require" || importMeta(callee.object)))
            )
              check(node, source);
          },
          NewExpression(node) {
            const [entry, base] = node.arguments;
            if (
              node.callee.name === "URL" &&
              member(base) === "url" &&
              importMeta(base.object) &&
              node.parent?.type === "NewExpression" &&
              ["Worker", "SharedWorker"].includes(node.parent.callee.name)
            )
              check(node, entry);
          },
        };
      },
    },
  },
};
