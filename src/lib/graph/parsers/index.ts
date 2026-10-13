import type { ParsedFile } from "./ts";
import { parseTypeScriptFile } from "./ts";

/**
 * Parser adapter registry.
 *
 * Every language is behind the same interface, so adding one is a new file and
 * a line here — no changes to the extractor, the store or the UI. Only
 * JavaScript/TypeScript ships today; the seam exists so Python, Java, Go and C#
 * can follow without restructuring anything.
 */
export interface LanguageParser {
  id: string;
  label: string;
  /** Lower-case file extensions, without the dot. */
  extensions: string[];
  parse(path: string, content: string): ParsedFile;
}

const typescriptParser: LanguageParser = {
  id: "typescript",
  label: "JavaScript / TypeScript",
  extensions: ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"],
  parse: parseTypeScriptFile,
};

export const PARSERS: LanguageParser[] = [typescriptParser];

/** Extensions we deliberately skip — parsers for these are not implemented yet. */
export const UNSUPPORTED_EXTENSIONS = new Set([
  "py", "java", "go", "rs", "rb", "php", "cs", "kt", "swift", "scala", "c", "cpp", "h", "hpp",
]);

export function parserForPath(path: string): LanguageParser | null {
  const base = path.split("/").pop() ?? "";
  // Skip declaration files — they describe types, not behaviour, and would
  // produce a large number of nodes with no relationships.
  if (/\.d\.ts$/i.test(base)) return null;
  const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
  if (!ext) return null;
  return PARSERS.find((p) => p.extensions.includes(ext)) ?? null;
}

export type { ParsedFile };
