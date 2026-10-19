import { test } from "node:test";
import assert from "node:assert/strict";
import type { Chunk } from "../ai/chunk";
import { classifyRole, comprehend, explainChunk, relevance } from "../ai/comprehend";
import type { Retrieved } from "../ai/retrieve";

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

function retrieved(c: Chunk): Retrieved {
  return { chunk: c, score: 1, reasons: [] };
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

/* ------------------------------------------------------------------ */
/* The assembled answer                                                */
/* ------------------------------------------------------------------ */

const authChunk = chunk({
  path: "backend/middleware/auth.js",
  symbol: "protectAndCheckSubscription",
  text: [
    "import jwt from 'jsonwebtoken';",
    "const protectAndCheckSubscription = async (req, res, next) => {",
    "  let token;",
    "  if (req.headers.authorization) token = req.headers.authorization.split(' ')[1];",
    "  if (!token) return res.status(401).json({ message: 'Not authorized' });",
    "  const decoded = jwt.verify(token, process.env.JWT_SECRET);",
    "  const user = await User.findById(decoded.id);",
    "  if (!user.isSubscribed) return res.status(403).json({ message: 'No subscription' });",
    "  next();",
    "};",
  ].join("\n"),
});

test("the offline answer explains rather than dumps code", () => {
  const { answer, sources } = comprehend("acme/app", "how does authentication work", [
    retrieved(authChunk),
  ]);

  // It identifies what the code is…
  assert.match(answer, /guard|middleware/i);
  // …names the symbol and cites the file…
  assert.match(answer, /protectAndCheckSubscription/);
  assert.match(answer, /backend\/middleware\/auth\.js/);
  // …states the dependencies it read…
  assert.match(answer, /jsonwebtoken/);
  // …and reports the real signals.
  assert.match(answer, /JWT_SECRET/);
  assert.match(answer, /401/);

  // It must NOT be a raw paste of the function body.
  assert.ok(
    !answer.includes("const decoded = jwt.verify(token, process.env.JWT_SECRET);"),
    "the answer should explain, not paste source"
  );

  assert.ok(sources.length > 0);
  assert.match(sources[0], /^backend\/middleware\/auth\.js:/);
});

test("the offline answer lists delegation steps for the lead site", () => {
  const { answer } = comprehend("acme/app", "login", [retrieved(authChunk)]);
  assert.match(answer, /delegates to/i);
  assert.match(answer, /jwt/);
});

test("multiple matches are summarised with their roles", () => {
  const other = chunk({
    path: "frontend/src/utils/firebase.js",
    kind: "block",
    text: "const auth = process.env.KEY;\nexport const app = initializeApp({ auth });",
  });
  const { answer } = comprehend("acme/app", "authentication", [
    retrieved(authChunk),
    retrieved(other),
  ]);
  assert.match(answer, /other place/);
  assert.match(answer, /firebase\.js/);
});

test("no results produces an honest refusal, not a fabrication", () => {
  const { answer, sources } = comprehend("acme/app", "how does the quantum engine work", []);
  assert.match(answer, /couldn't find/i);
  assert.deepEqual(sources, []);
});

test("the answer never claims a file it did not read", () => {
  const { answer, sources } = comprehend("acme/app", "auth", [retrieved(authChunk)]);
  // Every citation must correspond to a real retrieved chunk.
  for (const s of sources) {
    assert.ok(s.startsWith("backend/middleware/auth.js"), `unexpected citation ${s}`);
  }
  assert.ok(!answer.includes("index.css"));
});

test("with no provider the closing invites adding one", () => {
  const { answer } = comprehend("acme/app", "auth", [retrieved(authChunk)], "no-provider");
  assert.match(answer, /Add an AI provider key/);
});

test("when a provider exists but failed, the closing does not ask for a key", () => {
  const { answer } = comprehend(
    "acme/app",
    "auth",
    [retrieved(authChunk)],
    "provider-failed"
  );
  assert.match(answer, /provider is configured but did not respond/i);
  assert.ok(
    !/Add an AI provider key/i.test(answer),
    "must not tell the reader to add a key that already exists"
  );
});

test("a manifest-only answer says it came from the package manifest", () => {
  const { answer } = comprehend(
    "acme/app",
    "what database do they use",
    [retrieved(authChunk)],
    "external-only"
  );
  assert.match(answer, /package manifest/i);
  assert.ok(
    !/provider is configured but did not respond/i.test(answer),
    "a manifest answer is not a provider failure"
  );
});

test("only a manifest with no other signal yields the manifest closing", () => {
  const { answer } = comprehend(
    "acme/app",
    "what database do they use",
    [retrieved(authChunk)],
    "provider-failed"
  );
  assert.ok(!/package manifest/i.test(answer));
});

test("packages are attributed per file, not merged across files", () => {
  const a = chunk({
    path: "backend/db.js",
    symbol: "connect",
    text: "import mongoose from 'mongoose';\nexport const connect = () => mongoose.connect(URL);",
  });
  const b = chunk({
    path: "frontend/app.js",
    symbol: "init",
    text: "import axios from 'axios';\nexport const init = () => axios.get('/');",
  });
  const { answer } = comprehend("acme/app", "how do these work", [
    retrieved(a),
    retrieved(b),
  ]);
  // The two packages must not be presented as one merged dependency list.
  assert.match(answer, /Packages each match depends on/);
  const mergeLine = answer.match(/It imports: .*/);
  assert.equal(mergeLine, null, "must not merge across files");
});

test("a test file never leads the answer when implementation is present", () => {
  /*
   * A test that exercises a feature matches the same identifiers and literals as
   * the implementation, so it can out-score it — "How does authentication work?"
   * opened on `comprehend.test.ts` and described the test's assertions. Tests are
   * evidence about the feature, not the feature.
   *
   * The fixtures below are built so the test file genuinely wins on relevance
   * (its symbol repeats the question's terms); the answer must still lead with
   * the implementation.
   */
  const impl = chunk({
    path: "src/lib/auth.ts",
    symbol: "requireAuth",
    text: [
      "export function requireAuth(req, res, next) {",
      "  const t = req.headers.authorization;",
      "  try { return next(); }",
      "  catch { return res.status(401).json({ error: 'unauthorized' }); }",
      "}",
    ].join("\n"),
  });
  const testFile = chunk({
    path: "src/lib/__tests__/auth.test.ts",
    symbol: "authentication work",
    text: [
      "test('authentication work', () => {",
      "  // authentication work: assert the guard rejects a bad token",
      "  expect(requireAuth).toThrow();",
      "});",
    ].join("\n"),
  });

  const { answer } = comprehend("acme/app", "how does authentication work", [
    retrieved(testFile),
    retrieved(impl),
  ]);

  const firstLine = answer.split("\n")[0];
  assert.match(firstLine, /src\/lib\/auth\.ts/, "must lead with the implementation");
  assert.ok(!/__tests__/.test(firstLine), `must not open on a test: ${firstLine}`);
  // The test is still cited — it is part of the thread, just not the lead.
  assert.match(answer, /__tests__\/auth\.test\.ts/);
});

test("when every match is a test, a test may lead", () => {
  const only = chunk({
    path: "src/lib/__tests__/auth.test.ts",
    symbol: "rejects a bad token",
    text: "test('rejects a bad token', () => { expect(fn).toThrow(); });",
  });
  const { answer } = comprehend("acme/app", "how does auth work", [retrieved(only)]);
  assert.match(answer.split("\n")[0], /__tests__/);
});

test("says so when the best match shares no vocabulary with the question", () => {
  // Retrieval returns *something* for any question, and calling the top chunk
  // "the clearest match" asserts a relevance that does not exist.
  const unrelated = chunk({
    path: "src/app/api/status/route.ts",
    symbol: "GET",
    text: "export async function GET() { return Response.json({ ok: true }); }",
  });
  const { answer } = comprehend("acme/app", "Where is the Kubernetes deployment configured?", [
    retrieved(unrelated),
  ]);
  assert.match(answer, /closest code I could find/i);
  assert.match(answer, /probably not what you are asking about/i);
  assert.ok(
    !/The clearest match is/i.test(answer),
    "must not claim relevance it does not have"
  );
});

test("does not hedge when the vocabulary merely differs in form", () => {
  // "authentication" vs `requireAuth` is a morphology gap, not an absent feature.
  const impl = chunk({
    path: "src/lib/auth.ts",
    symbol: "requireAuth",
    text: "export function requireAuth(req, res, next) { return next(); }",
  });
  const { answer } = comprehend("acme/app", "How does authentication work?", [retrieved(impl)]);
  assert.match(answer, /The clearest match is/i);
  assert.ok(!/probably not what you are asking about/i.test(answer));
});
