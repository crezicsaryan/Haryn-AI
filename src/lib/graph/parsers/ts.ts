import ts from "typescript";

/**
 * TypeScript / JavaScript AST parser.
 *
 * Uses the TypeScript Compiler API rather than regexes, because the questions
 * being asked — what does this file export, what does this function call, what
 * does this class extend — are syntactic, and regexes get them wrong on real
 * code (comments, strings, nested scopes, generics).
 *
 * `createSourceFile` only parses. Nothing here type-checks, resolves modules
 * across files, or evaluates anything, so a hostile repository cannot cause
 * execution — the worst case is a parse error, which is caught and reported.
 */

export interface ParsedEntity {
  kind: "function" | "class" | "interface";
  name: string;
  startLine: number;
  endLine: number;
  exported: boolean;
  extendsName?: string;
  implementsNames?: string[];
  /** Callee names referenced inside the body — resolved later, cross-file. */
  calls: string[];
  /** Methods declared directly on a class. */
  methods?: string[];
}

export interface ParsedImport {
  specifier: string;
  /** Named bindings: `import { a, b as c }` → ["a", "c"] */
  names: string[];
  defaultName?: string;
  namespaceName?: string;
  line: number;
  /** `import x = require(...)` / `const x = require(...)` */
  isRequire?: boolean;
}

export interface ParsedRoute {
  method: string;
  path: string;
  line: number;
  handler?: string;
  /**
   * Callee names inside an inline handler.
   *
   * `router.get("/x", async (req, res) => { await getUser() })` has no named
   * handler to link to, so the calls are captured here and attached to the
   * endpoint node instead — otherwise the most useful edges in the graph (what
   * a route actually reaches) would be missing for exactly the style most
   * Express code is written in.
   */
  calls?: string[];
}

export interface ParsedModelUse {
  model: string;
  /** read | write | query */
  operation: "read" | "write" | "query";
  line: number;
}

export interface ParsedFile {
  entities: ParsedEntity[];
  imports: ParsedImport[];
  exports: { name: string; line: number }[];
  routes: ParsedRoute[];
  modelUses: ParsedModelUse[];
  /** Models declared in this file (Prisma `model X {}`, Mongoose, …). */
  modelDeclarations: { name: string; line: number }[];
  envVars: { name: string; line: number }[];
  /** Best-effort classification used to tag middleware/controller/service nodes. */
  isMiddleware: boolean;
  parseError?: string;
}

const ROUTE_METHODS = new Set([
  "get", "post", "put", "patch", "delete", "options", "head", "all", "use",
]);

/** HTTP verbs exported by Next.js App Router route handlers. */
const NEXT_HANDLERS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

/** Prisma client operations, mapped to read/write intent. */
const PRISMA_READ = new Set([
  "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany",
  "count", "aggregate", "groupBy",
]);
const PRISMA_WRITE = new Set([
  "create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany",
]);

const MONGOOSE_WRITE = new Set(["save", "insertOne", "insertMany", "updateOne", "updateMany", "deleteOne", "deleteMany", "findOneAndUpdate", "findOneAndDelete"]);
const MONGOOSE_READ = new Set(["find", "findOne", "findById", "countDocuments", "aggregate", "distinct"]);

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function endLineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
}

function scriptKindFor(path: string): ts.ScriptKind {
  const lower = path.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  if (lower.endsWith(".json")) return ts.ScriptKind.JSON;
  return ts.ScriptKind.TS;
}

/** Does this node carry an `export` modifier? */
function isExported(node: ts.Node): boolean {
  const mods = (node as { modifiers?: ts.NodeArray<ts.ModifierLike> }).modifiers;
  return Boolean(mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
}

/**
 * Collect the callee names referenced inside a subtree.
 *
 * Both the bare name (`getUser`) and the dotted form (`userService.getUser`)
 * are recorded: the first resolves against declarations in scope, the second
 * against a receiver's methods. Resolution happens later, once every file has
 * been parsed.
 */
function collectCalls(sf: ts.SourceFile, root: ts.Node, out: Set<string>): void {
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      if (ts.isIdentifier(expr)) {
        out.add(expr.text);
      } else if (ts.isPropertyAccessExpression(expr)) {
        out.add(expr.name.text);
        if (ts.isIdentifier(expr.expression)) {
          out.add(`${expr.expression.text}.${expr.name.text}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(root, visit);
}

/** Extract a static string from a node, if it is a plain string literal. */
function stringLiteral(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return null;
}

/**
 * Parse one source file.
 *
 * Never throws: a malformed file yields whatever was extracted before the
 * failure plus a `parseError`, so one bad file cannot fail an analysis.
 */
export function parseTypeScriptFile(path: string, content: string): ParsedFile {
  const result: ParsedFile = {
    entities: [],
    imports: [],
    exports: [],
    routes: [],
    modelUses: [],
    modelDeclarations: [],
    envVars: [],
    isMiddleware: false,
  };

  let sf: ts.SourceFile;
  try {
    sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, scriptKindFor(path));
  } catch (err) {
    result.parseError = err instanceof Error ? err.message : "parse failed";
    return result;
  }

  const isRouteFile = /(^|\/)route\.(ts|js|tsx|jsx)$/.test(path);
  const basename = path.split("/").pop() ?? "";
  result.isMiddleware = /middleware/i.test(basename) || /middleware/i.test(path);

  const envSeen = new Set<string>();

  const visit = (node: ts.Node): void => {
    /* ---- imports ------------------------------------------------- */
    if (ts.isImportDeclaration(node)) {
      const spec = stringLiteral(node.moduleSpecifier);
      if (spec) {
        const clause = node.importClause;
        const entry: ParsedImport = { specifier: spec, names: [], line: lineOf(sf, node) };
        if (clause) {
          if (clause.name) entry.defaultName = clause.name.text;
          const bindings = clause.namedBindings;
          if (bindings) {
            if (ts.isNamespaceImport(bindings)) {
              entry.namespaceName = bindings.name.text;
            } else if (ts.isNamedImports(bindings)) {
              entry.names = bindings.elements.map((e) => e.name.text);
            }
          }
        }
        result.imports.push(entry);
      }
    }

    /* ---- CommonJS require ---------------------------------------- */
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") {
      const spec = stringLiteral(node.arguments[0]);
      if (spec) {
        result.imports.push({ specifier: spec, names: [], line: lineOf(sf, node), isRequire: true });
      }
    }

    /* ---- exports -------------------------------------------------- */
    if (ts.isExportDeclaration(node)) {
      const spec = stringLiteral(node.moduleSpecifier);
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) {
          result.exports.push({ name: el.name.text, line: lineOf(sf, node) });
        }
      }
      // `export * from "./x"` — recorded as an import for dependency purposes.
      if (spec && !node.exportClause) {
        result.imports.push({ specifier: spec, names: ["*"], line: lineOf(sf, node) });
      }
    }

    /* ---- functions ------------------------------------------------ */
    if (ts.isFunctionDeclaration(node) && node.name) {
      const calls = new Set<string>();
      collectCalls(sf, node, calls);
      result.entities.push({
        kind: "function",
        name: node.name.text,
        startLine: lineOf(sf, node),
        endLine: endLineOf(sf, node),
        exported: isExported(node),
        calls: [...calls],
      });
    }

    /* ---- arrow / function expressions bound to a name ------------- */
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const init = decl.initializer;
        const isFn =
          init &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
        if (!isFn || !init) continue;

        const calls = new Set<string>();
        collectCalls(sf, init, calls);
        result.entities.push({
          kind: "function",
          name: decl.name.text,
          startLine: lineOf(sf, node),
          endLine: endLineOf(sf, node),
          exported: isExported(node),
          calls: [...calls],
        });

        // Next.js App Router: `export async function GET()` or
        // `export const POST = async () => {}` in a route file.
        if (isRouteFile && NEXT_HANDLERS.has(decl.name.text) && isExported(node)) {
          result.routes.push({
            method: decl.name.text,
            path: nextRoutePathFromFile(path),
            line: lineOf(sf, node),
            handler: decl.name.text,
          });
        }
      }
    }

    /* ---- Next.js route handlers (function declarations) ----------- */
    if (
      isRouteFile &&
      ts.isFunctionDeclaration(node) &&
      node.name &&
      NEXT_HANDLERS.has(node.name.text) &&
      isExported(node)
    ) {
      result.routes.push({
        method: node.name.text,
        path: nextRoutePathFromFile(path),
        line: lineOf(sf, node),
        handler: node.name.text,
      });
    }

    /* ---- classes --------------------------------------------------- */
    if (ts.isClassDeclaration(node) && node.name) {
      const calls = new Set<string>();
      collectCalls(sf, node, calls);
      const methods: string[] = [];
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
          methods.push(member.name.text);
        }
      }
      const heritage = node.heritageClauses ?? [];
      let extendsName: string | undefined;
      const implementsNames: string[] = [];
      for (const clause of heritage) {
        for (const t of clause.types) {
          const expr = t.expression;
          const name = ts.isIdentifier(expr) ? expr.text : ts.isPropertyAccessExpression(expr) ? expr.name.text : null;
          if (!name) continue;
          if (clause.token === ts.SyntaxKind.ExtendsKeyword) extendsName = name;
          else implementsNames.push(name);
        }
      }
      result.entities.push({
        kind: "class",
        name: node.name.text,
        startLine: lineOf(sf, node),
        endLine: endLineOf(sf, node),
        exported: isExported(node),
        extendsName,
        implementsNames,
        calls: [...calls],
        methods,
      });
    }

    /* ---- interfaces ------------------------------------------------ */
    if (ts.isInterfaceDeclaration(node)) {
      result.entities.push({
        kind: "interface",
        name: node.name.text,
        startLine: lineOf(sf, node),
        endLine: endLineOf(sf, node),
        exported: isExported(node),
        calls: [],
      });
    }

    /* ---- Express-style routes -------------------------------------- */
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (ROUTE_METHODS.has(method) && ts.isIdentifier(node.expression.expression)) {
        const receiver = node.expression.expression.text;
        // Only treat it as a route when the receiver reads like an app/router
        // and the first argument is a path — otherwise it is an ordinary call.
        const looksLikeRouter = /^(app|router|server|api|route|fastify|r)$/i.test(receiver);
        const path = stringLiteral(node.arguments[0]);
        if (looksLikeRouter && path && path.startsWith("/")) {
          const handlerArg = node.arguments[node.arguments.length - 1];
          const handler =
            handlerArg && ts.isIdentifier(handlerArg) ? handlerArg.text : undefined;

          // Inline handler → capture what it calls.
          let calls: string[] | undefined;
          if (handlerArg && (ts.isArrowFunction(handlerArg) || ts.isFunctionExpression(handlerArg))) {
            const set = new Set<string>();
            collectCalls(sf, handlerArg, set);
            calls = [...set];
          }

          result.routes.push({
            method: method === "use" ? "USE" : method.toUpperCase(),
            path,
            line: lineOf(sf, node),
            handler,
            calls,
          });
        }
      }
    }

    /* ---- ORM / database usage -------------------------------------- */
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const receiver = node.expression.expression;

      // `prisma.user.findMany()` — receiver is `prisma.user`
      if (ts.isPropertyAccessExpression(receiver) && ts.isIdentifier(receiver.expression)) {
        const client = receiver.expression.text;
        const model = receiver.name.text;
        if (/^prisma$/i.test(client) || /^db$/i.test(client) || /^tx$/i.test(client)) {
          const op = PRISMA_READ.has(method) ? "read" : PRISMA_WRITE.has(method) ? "write" : "query";
          result.modelUses.push({ model, operation: op, line: lineOf(sf, node) });
        }
      }

      // Mongoose document operations: `user.save()`, `User.find(...)`
      if (ts.isIdentifier(receiver)) {
        const recv = receiver.text;
        const looksLikeModel = /^[A-Z]/.test(recv);
        if (looksLikeModel && MONGOOSE_WRITE.has(method)) {
          result.modelUses.push({ model: recv, operation: "write", line: lineOf(sf, node) });
        } else if (looksLikeModel && MONGOOSE_READ.has(method)) {
          result.modelUses.push({ model: recv, operation: "read", line: lineOf(sf, node) });
        }
      }
    }

    // `mongoose.model("User", schema)` / `sequelize.define("User", {...})`
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if ((method === "model" || method === "define") && node.arguments.length) {
        const name = stringLiteral(node.arguments[0]);
        if (name) {
          result.modelDeclarations.push({ name, line: lineOf(sf, node) });
        }
      }
    }

    /* ---- environment variables ------------------------------------- */
    if (ts.isPropertyAccessExpression(node)) {
      const isProcessEnv =
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "env" &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "process";
      const isImportMetaEnv =
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "env" &&
        node.expression.expression.kind === ts.SyntaxKind.MetaProperty;
      if ((isProcessEnv || isImportMetaEnv) && !envSeen.has(node.name.text)) {
        envSeen.add(node.name.text);
        result.envVars.push({ name: node.name.text, line: lineOf(sf, node) });
      }
    }

    // Python/other languages are handled by their own adapters; JS only here.

    ts.forEachChild(node, visit);
  };

  try {
    ts.forEachChild(sf, visit);
  } catch (err) {
    result.parseError = err instanceof Error ? err.message : "traversal failed";
  }

  return result;
}

/**
 * Derive the route path a Next.js App Router file serves.
 *
 * `app/api/users/[id]/route.ts` → `/api/users/[id]`
 */
export function nextRoutePathFromFile(path: string): string {
  const parts = path.split("/").filter(Boolean);
  const appIdx = parts.findIndex((p) => p === "app" || p === "src");
  const start = appIdx === -1 ? 0 : parts.findIndex((p, i) => i > appIdx && p === "app") + 1 || appIdx + 1;
  const rel = parts.slice(start);
  const withoutFile = rel.slice(0, -1);
  const cleaned = withoutFile.filter(
    (p) => !/^\(.*\)$/.test(p) && !/^@/.test(p)
  );
  return `/${cleaned.join("/")}`.replace(/\/+$/, "") || "/";
}
