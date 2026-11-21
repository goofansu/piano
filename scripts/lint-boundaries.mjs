import { existsSync, readFileSync, realpathSync } from "node:fs";
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

function canonical(path) {
  for (const candidate of [path, `${path}.ts`, `${path}.tsx`, `${path}.js`, `${path}/index.ts`])
    if (existsSync(candidate)) return realpathSync(candidate);
  return path;
}

export default {
  meta: { name: "piano" },
  rules: {
    // CodeQL js/bad-tag-filter reports any regex that matches a script tag or HTML comment as a
    // weak sanitizer, even an assertion in a test.
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
        const layer = within(file, resolve(root, "web/src"))
          ? "web"
          : within(file, resolve(root, "shared"))
            ? "shared"
            : within(file, resolve(root, "server"))
              ? "server"
              : undefined;
        if (!layer) return {};
        const runtime = layer === "web" ? resolve(root, "web/src") : resolve(root, "server");
        const sharedRuntimeModule = layer !== "shared" && within(file, resolve(runtime, "shared"));
        const report = (node, specifier, reason) =>
          context.report({ node, messageId: "boundary", data: { reason, specifier } });
        function check(node, source) {
          if (!source) return;
          const specifier =
            typeof source.value === "string"
              ? source.value
              : source.type === "TemplateLiteral" && source.expressions.length === 0
                ? source.quasis[0].value.cooked
                : undefined;
          if (specifier === undefined) {
            report(node, "<computed>", "Use a literal module specifier");
            return;
          }
          const bare = specifier.split(/[?#]/)[0];
          const alias = (layer === "web" ? webAliases : serverAliases)
            .filter((a) => (a.wildcard ? bare.startsWith(a.prefix) : bare === a.prefix))
            .sort((a, b) => b.prefix.length - a.prefix.length)[0];
          const targets = alias
            ? alias.targets.map((t) => t.replaceAll("*", () => bare.slice(alias.prefix.length)))
            : bare.startsWith(".") || isAbsolute(bare)
              ? [resolve(dirname(file), bare)]
              : [];
          if (!targets.length) {
            if (layer === "shared" && !sharedPackages.has(specifier))
              report(
                node,
                specifier,
                "Shared external entry points require environment-neutral review",
              );
            if (specifier.startsWith("#") || specifier.startsWith("file:"))
              report(node, specifier, "Use a relative path or a tsconfig alias for local modules");
            return;
          }
          for (const target of targets.map(canonical)) {
            const allowed =
              layer === "server"
                ? !within(target, resolve(root, "web"))
                : within(target, resolve(root, "shared")) ||
                  (layer === "web" && within(target, resolve(root, "web/src")));
            if (
              !allowed ||
              (sharedRuntimeModule &&
                (within(target, resolve(runtime, "features")) ||
                  within(target, resolve(runtime, "app"))))
            ) {
              const owner = sharedRuntimeModule ? `Shared ${layer} modules` : layer;
              report(node, specifier, `${owner} cannot depend on ${relative(root, target)}`);
              break;
            }
          }
        }
        return {
          ImportDeclaration: (node) => check(node, node.source),
          ExportNamedDeclaration: (node) => check(node, node.source),
          ExportAllDeclaration: (node) => check(node, node.source),
          ImportExpression: (node) => check(node, node.source),
          TSImportType: (node) => check(node, node.source),
          TSExternalModuleReference: (node) => check(node, node.expression),
          CallExpression: (node) => {
            if (node.callee.type === "Identifier" && node.callee.name === "require")
              check(node, node.arguments[0]);
          },
        };
      },
    },
  },
};
