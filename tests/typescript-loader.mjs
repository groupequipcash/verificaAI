import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Node's test runner needs to resolve the extensionless imports used by Next.js.
export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL?.startsWith("file:") && specifier.startsWith(".") &&
      !/\.[cm]?[jt]s$/.test(specifier)) {
    const target = new URL(`${specifier}.ts`, context.parentURL);
    try {
      await access(fileURLToPath(target));
      return nextResolve(target.href, context);
    } catch { /* Leave other specifiers to Node. */ }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (!url.startsWith("file:") || !url.endsWith(".ts")) return nextLoad(url, context);
  const source = await readFile(fileURLToPath(url), "utf8");
  return {
    format: "module",
    shortCircuit: true,
    source: ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  };
}
