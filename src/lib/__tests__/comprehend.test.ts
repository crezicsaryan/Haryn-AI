import { test } from "node:test";
import assert from "node:assert/strict";
import type { Chunk } from "../ai/chunk";
import { classifyRole, explainChunk, relevance } from "../ai/comprehend";

function chunk(over: Partial<Chunk> & { text: string; path: string }): Chunk {
  return {
    id: over.id ?? over.path,
    path: over.path,
    language: over.language ?? "JavaScript",
    symbol: over.symbol ?? null,
    kind: over.kind ?? "function",
    startLine: over.startLine ?? 1,
    endLine: over.endLine ?? 20,
    text: over.text,
    imports: over.imports ?? [],
    bytes: over.text.length,
  };
}

/* ------------------------------------------------------------------ */
/* Role classification                                                 */
/* ------------------------------------------------------------------ */

test("express middleware is a guard regardless of its filename", () => {
  const c = chunk({
    path: "src/middleware/thing.js",
    text: "const protect = async (req, res, next) => { let token; try { next(); } catch (e) {} };",
  });
  assert.equal(classifyRole(c), "guard");
});

test("a handler reading req.body is a route", () => {
  const c = chunk({
    path: "src/controllers/user.js",
    text: "async function createUser(req, res) { const { email } = req.body; res.json({}); }",
  });
  assert.equal(classifyRole(c), "route");
});

test("router registration is a route", () => {
  const c = chunk({
    path: "src/routes.js",
    text: "router.post('/login', loginController);",
  });
  assert.equal(classifyRole(c), "route");
});

test("a test file is a test", () => {
  const c = chunk({
    path: "src/utils/__tests__/math.test.ts",
    text: "describe('add', () => { it('works', () => { expect(add(1,2)).toBe(3); }); });",
  });
  assert.equal(classifyRole(c), "test");
});

test("an orm call is data access", () => {
  const c = chunk({
    path: "src/repo.js",
    text: "const user = await prisma.user.findUnique({ where: { id } });",
  });
  assert.equal(classifyRole(c), "data");
});

test("raw SQL is data access", () => {
  const c = chunk({
    path: "src/db.js",
    text: "const rows = await client.query('SELECT * FROM users WHERE id = $1');",
  });
  assert.equal(classifyRole(c), "data");
});

test("env wiring at module scope is config", () => {
  const c = chunk({
    path: "src/firebase.js",
    text: "const apiKey = process.env.FIREBASE_KEY;\nexport const app = initializeApp({ apiKey });",
    kind: "block",
  });
  assert.equal(classifyRole(c), "config");
});

test("a react component is a component, and hooks make it stateful", () => {
  const comp = chunk({
    path: "src/Dashboard.jsx",
    text: "export default function Dashboard() { return <div>hi</div>; }",
  });
  assert.equal(classifyRole(comp), "component");

  const stateful = chunk({
    path: "src/Counter.jsx",
    text: "export default function Counter() { const [n, setN] = useState(0); return <b>{n}</b>; }",
  });
  assert.equal(classifyRole(stateful), "state");
});

test("a getter-style helper is a util", () => {
  const c = chunk({
    path: "src/format.js",
    text: "export function formatDate(d) { return new Date(d).toISOString(); }",
    symbol: "formatDate",
  });
  assert.equal(classifyRole(c), "util");
});

/* ------------------------------------------------------------------ */
/* Relevance                                                           */
/* ------------------------------------------------------------------ */

test("relevance ranks a symbol match above an incidental word match", () => {
  const asked = chunk({
    path: "src/auth.js",
    text: "function validateToken(t) { return jwt.verify(t, KEY); }",
    symbol: "validateToken",
  });
  const incidental = chunk({
    path: "src/other.js",
    text: "// token is mentioned in a comment here",
  });
  const q = "how does validateToken work";
  assert.ok(
    relevance(asked, q) > relevance(incidental, q),
    "the real implementation must outrank a comment"
  );
});

test("an empty question scores everything zero", () => {
  const c = chunk({ path: "a.js", text: "const x = 1;" });
  assert.equal(relevance(c, ""), 0);
});

/* ------------------------------------------------------------------ */
/* Explanation                                                         */
/* ------------------------------------------------------------------ */

test("explainChunk extracts calls, externals and signals", () => {
  const c = chunk({
    path: "src/auth.js",
    symbol: "login",
    text: [
      "import jwt from 'jsonwebtoken';",
      "import bcrypt from 'bcryptjs';",
      "import { findUser } from './users';",
      "async function login(req, res) {",
      "  const { email, password } = req.body;",
      "  const user = await findUser(email);",
      "  const ok = await bcrypt.compare(password, user.hash);",
      "  if (!ok) return res.status(401).json({ error: 'bad' });",
      "  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET);",
      "  return res.json({ token });",
      "}",
    ].join("\n"),
  });

  const site = explainChunk(c, "how does login work");
  assert.equal(site.role, "route");
  assert.ok(site.externals.includes("jsonwebtoken"));
  assert.ok(site.externals.includes("bcryptjs"));
  assert.ok(!site.externals.includes("./users"), "relative imports are not packages");
  assert.ok(site.calls.includes("findUser"));
  // Qualified calls keep their namespace, which is the informative part.
  assert.ok(
    site.calls.includes("bcrypt.compare"),
    `expected bcrypt.compare, got ${site.calls.join(", ")}`
  );
  assert.deepEqual(site.signals.env, ["JWT_SECRET"]);
  assert.ok(site.signals.statusCodes.includes(401));
  assert.ok(site.signals.authWords.includes("jwt"));
});

test("builtins and noise are not listed as calls", () => {
  const c = chunk({
    path: "a.js",
    text: "const x = arr.map(f).filter(Boolean); console.log(x).toString();",
  });
  const site = explainChunk(c, "x");
  for (const noise of ["map", "filter", "console", "log", "toString"]) {
    assert.ok(!site.calls.includes(noise), `${noise} should be filtered out`);
  }
});
