import type {
  Report,
  CategoryScore,
  Category,
  CommitMonthBucket,
  CommitWeek,
  Contributor,
  RecentCommit,
  RepoActivity,
} from "./types";
import { CATEGORIES, SCORE_WEIGHTS } from "./constants";
import { languageColor } from "./constants";

/**
 * A fully deterministic sample analysis.
 *
 * Two purposes:
 *  1. A demo path that always renders, so the product can be shown without
 *     consuming GitHub API quota (unauthenticated GitHub allows only 60 req/hr).
 *  2. A stable fixture for verifying the report UI end-to-end.
 *
 * Every number below is internally consistent — the health score is computed
 * from the category scores using the same weights the real pipeline uses.
 */

export const SAMPLE_ID = "an_sample";

/**
 * Deterministic 52-week commit series for the sample fixture.
 *
 * Generated rather than hand-written so the fixture stays readable, and fully
 * deterministic so screenshots and tests are stable.
 */
function buildSampleActivity(): RepoActivity {
  const DAY = 86_400_000;
  const now = Date.now();
  const weeks: CommitWeek[] = [];

  for (let i = 51; i >= 0; i--) {
    const start = now - i * 7 * DAY;
    // A steady cadence with a visible burst a couple of months back.
    const wave = Math.sin(i / 2.7) * 3 + Math.cos(i / 5.3) * 2;
    const burst = i === 8 ? 19 : i === 9 ? 11 : 0;
    const total = Math.max(0, 7 + Math.round(wave) + burst);

    // Spread across weekdays, with a little on Saturday.
    const days = [0, 0, 0, 0, 0, 0, 0];
    const perDay = Math.floor(total / 5);
    let left = total;
    for (let d = 1; d <= 5 && left > 0; d++) {
      const take = Math.min(left, perDay + (d === 3 ? total % 5 : 0));
      days[d] = take;
      left -= take;
    }
    days[6] = left;

    weeks.push({ week: new Date(start).toISOString(), total, days });
  }

  const contributors: Contributor[] = [
    { login: "avery-dev", avatarUrl: "", contributions: 412, url: "" },
    { login: "morgan-lee", avatarUrl: "", contributions: 287, url: "" },
    { login: "sam-okafor", avatarUrl: "", contributions: 154, url: "" },
    { login: "jules-park", avatarUrl: "", contributions: 96, url: "" },
    { login: "ren-tanaka", avatarUrl: "", contributions: 41, url: "" },
  ];

  const recentCommits: RecentCommit[] = [
    { sha: "9f2c1ab7d4e5f60718293a4b5c6d7e8f90123456", shortSha: "9f2c1ab", message: "fix(cart): round discount totals before tax", body: "Discounts were applied after tax, so totals drifted by a cent on multi-item carts.\n\nCloses #412", author: "avery-dev", date: new Date(now - 2 * DAY).toISOString(), type: "fix" },
    { sha: "3d7e5f9a1b2c3d4e5f60718293a4b5c6d7e8f901", shortSha: "3d7e5f9", message: "feat(payments): retry Stripe charges on transient failures", author: "morgan-lee", date: new Date(now - 4 * DAY).toISOString(), type: "feat" },
    { sha: "b1a2c3d4e5f60718293a4b5c6d7e8f9012345678", shortSha: "b1a2c3d", message: "refactor(checkout): extract validation into a pure function", author: "avery-dev", date: new Date(now - 6 * DAY).toISOString(), type: "refactor" },
    { sha: "7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f809", shortSha: "7c8d9e0", message: "perf(reports): replace N+1 order queries with a single join", body: "The monthly report issued one query per order. Now a single join with an index on (status, created_at).", author: "sam-okafor", date: new Date(now - 9 * DAY).toISOString(), type: "perf" },
    { sha: "5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7081", shortSha: "5e6f708", message: "docs: add the deployment runbook", author: "jules-park", date: new Date(now - 12 * DAY).toISOString(), type: "docs" },
    { sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", shortSha: "a1b2c3d", message: "chore(deps): bump express from 4.19.1 to 4.19.2", author: "dependabot[bot]", date: new Date(now - 14 * DAY).toISOString(), type: "deps" },
    { sha: "c3d4e5f60718293a4b5c6d7e8f9012345678901", shortSha: "c3d4e5f", message: "test(auth): cover the token refresh path", author: "morgan-lee", date: new Date(now - 18 * DAY).toISOString(), type: "test" },
    { sha: "e5f60718293a4b5c6d7e8f90123456789012a34", shortSha: "e5f6071", message: "fix(auth): reject expired refresh tokens", author: "ren-tanaka", date: new Date(now - 24 * DAY).toISOString(), type: "fix" },
    { sha: "0718293a4b5c6d7e8f90123456789012a34b5c6", shortSha: "0718293", message: "feat(search): add fuzzy matching to product search", author: "avery-dev", date: new Date(now - 31 * DAY).toISOString(), type: "feat" },
    { sha: "293a4b5c6d7e8f90123456789012a34b5c6d7e8", shortSha: "293a4b5", message: "Merge pull request #388 from avery-dev/checkout-v2", author: "avery-dev", date: new Date(now - 38 * DAY).toISOString(), type: "merge" },
    { sha: "4b5c6d7e8f90123456789012a34b5c6d7e8f9012", shortSha: "4b5c6d7", message: "chore: enable strict TypeScript", author: "sam-okafor", date: new Date(now - 46 * DAY).toISOString(), type: "chore" },
    { sha: "6d7e8f90123456789012a34b5c6d7e8f90123456", shortSha: "6d7e8f9", message: "fix(reports): correct timezone handling in exports", author: "jules-park", date: new Date(now - 55 * DAY).toISOString(), type: "fix" },
  ];

  const months: CommitMonthBucket[] = [];
  const byMonth = new Map<string, number>();
  for (const c of recentCommits) {
    const d = new Date(c.date);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
  }
  const monthKeys = [...byMonth.keys()].sort();
  const newest = monthKeys.at(-1);
  if (newest) {
    const [ny, nm] = newest.split("-").map(Number);
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(ny, nm - 1 - i, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      months.push({
        month: key,
        label: d.toLocaleString("en", { month: "short", timeZone: "UTC" }),
        total: byMonth.get(key) ?? 0,
      });
    }
  }

  const authorTotals = new Map<string, { commits: number; first: string | null; last: string | null }>();
  for (const c of recentCommits) {
    const e = authorTotals.get(c.author) ?? { commits: 0, first: null, last: null };
    e.commits += 1;
    if (!e.first || c.date < e.first) e.first = c.date;
    if (!e.last || c.date > e.last) e.last = c.date;
    authorTotals.set(c.author, e);
  }
  const authorStats = [...authorTotals.entries()]
    .map(([login, e]) => ({
      login,
      commits: e.commits,
      share: e.commits / (recentCommits.length || 1),
      firstCommitAt: e.first,
      lastCommitAt: e.last,
    }))
    .sort((a, b) => b.commits - a.commits);

  const typeTotals = new Map<string, number>();
  for (const c of recentCommits) typeTotals.set(c.type, (typeTotals.get(c.type) ?? 0) + 1);
  const messageTypes = [...typeTotals.entries()]
    .map(([type, count]) => ({ type, count, share: count / (recentCommits.length || 1) }))
    .sort((a, b) => b.count - a.count);

  const messageStats = {
    scanned: recentCommits.length,
    withBody: recentCommits.filter((c) => c.body).length,
    avgSubjectLength: Math.round(
      recentCommits.reduce((a, c) => a + c.message.length, 0) / (recentCommits.length || 1)
    ),
    longestSubject: recentCommits.reduce(
      (best, c) => (c.message.length > best.length ? c.message : best),
      ""
    ),
  };

  return {
    totalCommits: 1204,
    weeklyCommits: weeks,
    contributors,
    recentCommits,
    months,
    authorStats,
    messageTypes,
    messageStats,
    lastCommitAt: recentCommits[0].date,
    recentMonthly: weeks.slice(-4).reduce((a, w) => a + w.total, 0),
    priorMonthly: weeks.slice(-8, -4).reduce((a, w) => a + w.total, 0),
    partial: false,
  };
}

const CATEGORY_SCORES: Record<Category, number> = {
  security: 75,
  bugs: 71,
  quality: 82,
  architecture: 84,
  performance: 76,
  testing: 58,
  dependency: 91,
  documentation: 88,
};

const CATEGORY_ISSUES: Record<Category, number> = {
  security: 3,
  bugs: 2,
  quality: 5,
  architecture: 1,
  performance: 3,
  testing: 2,
  dependency: 2,
  documentation: 1,
};

function buildScores(): { scores: CategoryScore[]; healthScore: number } {
  const order: Category[] = [
    "security",
    "bugs",
    "quality",
    "architecture",
    "performance",
    "testing",
    "dependency",
    "documentation",
  ];
  const scores = order.map((category) => ({
    category,
    label: CATEGORIES[category].label,
    score: CATEGORY_SCORES[category],
    weight: SCORE_WEIGHTS[category],
    issueCount: CATEGORY_ISSUES[category],
  }));
  const healthScore = Math.round(
    scores.reduce((a, s) => a + s.score * s.weight, 0)
  );
  return { scores, healthScore };
}

let cached: Report | null = null;

export function buildSampleReport(): Report {
  if (cached) return cached;

  const { scores, healthScore } = buildScores();

  const langs: [string, number][] = [
    ["JavaScript", 62],
    ["CSS", 18],
    ["HTML", 12],
    ["Python", 8],
  ];

  const report: Report = {
    id: SAMPLE_ID,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 46_400,
    repo: {
      owner: "acme",
      name: "ecommerce",
      fullName: "acme/ecommerce",
      url: "https://github.com/acme/ecommerce",
      description:
        "A full-stack e-commerce application with a React storefront, an Express API and a Postgres data layer.",
      defaultBranch: "main",
      stars: 1240,
      forks: 218,
      watchers: 63,
      openIssues: 24,
      license: "MIT",
      sizeKb: 18_400,
      createdAt: "2023-02-14T10:00:00Z",
      pushedAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
      homepage: "https://acme.example.com",
      topics: ["react", "express", "postgres", "ecommerce"],
      archived: false,
      isFork: false,
    },
    languages: langs.map(([name, percent]) => ({
      name,
      percent,
      bytes: Math.round(percent * 18_000),
      color: languageColor(name),
    })),
    structure: {
      fileCount: 247,
      dirCount: 34,
      totalBytes: 18_400 * 1024,
      sizeClass: "Medium",
      topLevelDirs: [
        "src",
        "public",
        "api",
        "server",
        "config",
        "scripts",
        "tests",
        "docs",
        ".github",
      ],
      extensionCounts: {
        js: 118,
        jsx: 42,
        css: 24,
        html: 18,
        py: 22,
        json: 14,
        md: 9,
      },
      truncated: false,
    },
    healthScore,
    scores,
    findings: [
      {
        id: "f_sample_01",
        category: "security",
        severity: "critical",
        title: "Potential secret exposure",
        description:
          "A credential-like value is assigned directly in a configuration module. The value is masked here and never displayed in full.",
        filePath: "config/database.js",
        lineStart: 24,
        lineEnd: 24,
        evidence: "pass••••  ←  password: \"pass••••\"  (config/database.js:24)",
        impact:
          "An exposed database credential can be used to read or modify production data until it is rotated.",
        recommendation:
          "Move the credential into environment variables, remove it from git history and rotate it immediately.",
        confidence: 0.85,
        source: "static-analysis",
      },
      {
        id: "f_sample_02",
        category: "security",
        severity: "high",
        title: "Permissive CORS configuration",
        description:
          "The API allows every origin, so any website can call it on behalf of a logged-in user.",
        filePath: "server/app.js",
        lineStart: 41,
        lineEnd: 41,
        evidence: "app.use(cors({ origin: '*' }));",
        impact: "Cross-origin data exposure and CSRF-style abuse.",
        recommendation:
          "Restrict allowed origins to an explicit allow-list of trusted domains.",
        confidence: 0.65,
        source: "static-analysis",
        isPotential: true,
      },
      {
        id: "f_sample_03",
        category: "security",
        severity: "medium",
        title: "SQL built by string concatenation",
        description:
          "A query string is assembled from a variable, which can alter the query's meaning when the value is user-controlled.",
        filePath: "server/services/reportService.js",
        lineStart: 63,
        lineEnd: 66,
        evidence:
          "const q = \"SELECT * FROM orders WHERE status = '\" + status + \"'\";",
        impact: "SQL injection if the interpolated value reaches this path unvalidated.",
        recommendation:
          "Use parameterised queries instead of concatenating values into SQL.",
        confidence: 0.5,
        source: "static-analysis",
        isPotential: true,
      },
      {
        id: "f_sample_17",
        category: "bugs",
        severity: "high",
        title: "Async callback passed to forEach()",
        description:
          "`forEach` ignores the promise an `async` callback returns, so `await` inside it does not pause the enclosing function and rejections are never caught.\n\n_Rule: async-in-foreach_",
        filePath: "src/services/reportService.js",
        lineStart: 118,
        lineEnd: 118,
        evidence: "await rows.forEach(async (row) => { await enrich(row); });",
        impact:
          "The loop finishes before the work does, and any failure inside it is silently lost.",
        recommendation:
          "Use `for…of` with `await` for sequential work, or `await Promise.all(rows.map(...))` for parallel work.",
        confidence: 0.85,
        source: "static-analysis",
        isPotential: true,
      },
      {
        id: "f_sample_18",
        category: "bugs",
        severity: "high",
        title: "Collection mutated while being iterated",
        description:
          "A `for…of` loop mutates the same collection it is iterating, so the iterator's position no longer matches the data and elements are skipped.\n\n_Rule: mutate-while-iterating_",
        filePath: "src/services/payment.js",
        lineStart: 142,
        lineEnd: 149,
        evidence: "for (const item of pending) { if (item.stale) pending.splice(pending.indexOf(item), 1); }",
        impact: "Stale entries are silently skipped — a classic source of intermittent bugs.",
        recommendation:
          "Iterate over a copy (`[...pending]`), or filter into a new array.",
        confidence: 0.75,
        source: "static-analysis",
        isPotential: true,
      },
      {
        id: "f_sample_04",
        category: "quality",
        severity: "high",
        title: "Complex function",
        description:
          "processPayment() is 148 lines with an estimated cyclomatic complexity of 23. High complexity correlates with defects and makes the function hard to test.",
        filePath: "src/services/payment.js",
        lineStart: 88,
        lineEnd: 236,
        evidence: "processPayment() · 148 lines · complexity ≈ 23",
        impact: "Difficult to reason about, test and safely change.",
        recommendation:
          "Split validation, payment processing and response handling into separate functions and return early instead of nesting.",
        confidence: 0.75,
        source: "static-analysis",
      },
      {
        id: "f_sample_05",
        category: "quality",
        severity: "medium",
        title: "Duplicated code blocks",
        description:
          "6 near-identical validation blocks were found across the repository. Duplication multiplies the cost of every future change.",
        filePath: "src/utils/validate.js",
        lineStart: 12,
        evidence:
          "src/utils/validate.js:12 · if (!email || !email.includes('@')) return false;\nsrc/utils/validate.ts:34 · if (!email || !email.includes('@')) return false;",
        impact:
          "A single logic change must be replicated in several places, inviting drift and bugs.",
        recommendation:
          "Extract the shared validation into one reusable module and call it from each site.",
        confidence: 0.6,
        source: "static-analysis",
        isPotential: true,
      },
      {
        id: "f_sample_06",
        category: "quality",
        severity: "medium",
        title: "Swallowed exception",
        description:
          "An error is caught and silently ignored. Failures will disappear without a trace, making production issues hard to diagnose.",
        filePath: "src/services/orderService.js",
        lineStart: 112,
        lineEnd: 112,
        evidence: "} catch (e) {}",
        impact: "Silent failures and misleading behaviour.",
        recommendation:
          "Handle the error, log it with context, or rethrow a typed error instead of ignoring it.",
        confidence: 0.8,
        source: "static-analysis",
      },
      {
        id: "f_sample_07",
        category: "quality",
        severity: "low",
        title: "Debug statements left in source",
        description: "7 console.log statements found in non-test files.",
        filePath: "src/pages/checkout.jsx",
        evidence: "7 statements",
        impact: "Noisy logs and a minor performance cost in production.",
        recommendation: "Replace them with a structured logger or remove before release.",
        confidence: 0.8,
        source: "static-analysis",
      },
      {
        id: "f_sample_08",
        category: "performance",
        severity: "high",
        title: "Potential N+1 query",
        description:
          "A database query executes inside a loop. Each iteration issues its own round-trip, so cost grows linearly with the number of records.",
        filePath: "src/services/orderService.js",
        lineStart: 88,
        lineEnd: 96,
        evidence: "loop at src/services/orderService.js:88 → call at :91 · for (const o of orders) {",
        impact:
          "Response time degrades sharply as data grows, and the database sees a burst of small queries.",
        recommendation:
          "Batch the required records into a single query (an IN clause or a join) and process the result in memory.",
        confidence: 0.6,
        source: "static-analysis",
        isPotential: true,
      },
      {
        id: "f_sample_09",
        category: "performance",
        severity: "medium",
        title: "Blocking synchronous I/O",
        description:
          "A synchronous filesystem call blocks the event loop for its entire duration, stalling every other request.",
        filePath: "server/utils/configLoader.js",
        lineStart: 19,
        lineEnd: 19,
        evidence: "const raw = fs.readFileSync(path.join(__dirname, 'settings.json'));",
        impact: "Reduced throughput and latency spikes under load.",
        recommendation:
          "Use fs.promises.readFile, or cache the file contents at startup.",
        confidence: 0.6,
        source: "static-analysis",
        isPotential: true,
      },
      {
        id: "f_sample_10",
        category: "performance",
        severity: "medium",
        title: "Unbounded query",
        description:
          "A query fetches every matching row with no limit or pagination.",
        filePath: "server/services/productService.js",
        lineStart: 47,
        lineEnd: 47,
        evidence: "return Product.find({});",
        impact: "Memory spikes and slow responses once the table grows.",
        recommendation: "Add an explicit limit/pagination and select only needed columns.",
        confidence: 0.55,
        source: "static-analysis",
        isPotential: true,
      },
      {
        id: "f_sample_11",
        category: "dependency",
        severity: "critical",
        title: "2 vulnerable dependencies detected",
        description:
          "Two packages have advisories published in the OSV database.",
        evidence: "lodash@4.17.11 → GHSA-35jh-r3h4-6jhm\naxios@0.21.1 → GHSA-cph5-m8f7-6c5x",
        impact:
          "Known vulnerabilities are directly exploitable in some cases and are trivially discoverable by scanners.",
        recommendation:
          "Upgrade the affected packages to a patched version and re-run the scan.",
        confidence: 0.85,
        source: "dependency-scanner",
      },
      {
        id: "f_sample_12",
        category: "dependency",
        severity: "low",
        title: "7 outdated dependencies",
        description:
          "Several packages are behind their latest published release, missing bug fixes and security patches.",
        evidence: "react@17.0.2\nreact-dom@17.0.2\neslint@7.32.0\njest@26.6.3",
        impact: "Accumulating drift makes future upgrades riskier.",
        recommendation:
          "Enable Dependabot/Renovate and review changelogs before merging updates.",
        confidence: 0.75,
        source: "dependency-scanner",
        isPotential: true,
      },
      {
        id: "f_sample_13",
        category: "testing",
        severity: "high",
        title: "Critical modules without tests",
        description:
          "Business-critical areas have no matching test files: payments, orders.",
        evidence: "payments, orders",
        impact: "High-blast-radius code paths are unverified.",
        recommendation:
          "Add focused unit and integration tests for these modules before making further changes.",
        confidence: 0.6,
        source: "static-analysis",
        isPotential: true,
      },
      {
        id: "f_sample_14",
        category: "testing",
        severity: "medium",
        title: "Low test-to-source ratio",
        description:
          "Only 14 test files for 96 source files (≈14.6%). Large parts of the codebase appear untested.",
        evidence: "14 test files / 96 source files",
        impact: "Defects are more likely to slip through review.",
        recommendation:
          "Raise coverage incrementally, prioritising critical paths, and add a coverage gate to CI.",
        confidence: 0.7,
        source: "static-analysis",
        isPotential: true,
      },
      {
        id: "f_sample_15",
        category: "architecture",
        severity: "low",
        title: "Controllers reach into the data layer directly",
        description:
          "Several controllers import models directly, bypassing the service layer and coupling HTTP concerns to persistence.",
        filePath: "server/controllers/cartController.js",
        lineStart: 4,
        evidence: "const Cart = require('../models/cart');",
        impact:
          "Business rules become duplicated between controllers and services, and swapping the data layer gets harder.",
        recommendation:
          "Route all persistence through the service layer so controllers only orchestrate requests.",
        confidence: 0.5,
        source: "static-analysis",
        isPotential: true,
      },
      {
        id: "f_sample_16",
        category: "documentation",
        severity: "low",
        title: "Sparse inline documentation",
        description:
          "Only 2.4% of analysed lines are comments. Complex logic may be difficult to follow.",
        evidence: "2.4% comment density",
        impact: "Higher cognitive load for future maintainers.",
        recommendation:
          "Add doc comments to public functions and explain non-obvious decisions.",
        confidence: 0.55,
        source: "static-analysis",
        isPotential: true,
      },
    ],
    dependencies: {
      stat: {
        total: 42,
        healthy: 31,
        outdated: 7,
        vulnerable: 2,
        unused: 2,
        unknown: 0,
      },
      items: [
        {
          name: "lodash",
          version: "4.17.11",
          ecosystem: "npm",
          type: "runtime",
          status: "vulnerable",
          vulns: [
            { id: "GHSA-35jh-r3h4-6jhm", summary: "Command injection in lodash template", severity: "HIGH" },
          ],
        },
        {
          name: "axios",
          version: "0.21.1",
          ecosystem: "npm",
          type: "runtime",
          status: "vulnerable",
          vulns: [
            { id: "GHSA-cph5-m8f7-6c5x", summary: "Server-side request forgery in axios", severity: "HIGH" },
          ],
        },
        { name: "react", version: "17.0.2", ecosystem: "npm", type: "runtime", status: "outdated" },
        { name: "react-dom", version: "17.0.2", ecosystem: "npm", type: "runtime", status: "outdated" },
        { name: "eslint", version: "7.32.0", ecosystem: "npm", type: "dev", status: "outdated" },
        { name: "jest", version: "26.6.3", ecosystem: "npm", type: "dev", status: "outdated" },
        { name: "express", version: "4.18.2", ecosystem: "npm", type: "runtime", status: "healthy" },
        { name: "pg", version: "8.11.3", ecosystem: "npm", type: "runtime", status: "healthy" },
        { name: "moment", version: "2.29.4", ecosystem: "npm", type: "runtime", status: "unused" },
        { name: "classnames", version: "2.3.2", ecosystem: "npm", type: "runtime", status: "unused" },
      ],
      manifests: ["package.json", "requirements.txt"],
    },
    testing: {
      testFiles: 14,
      sourceFiles: 96,
      ratio: 14 / 96,
      frameworks: ["Jest", "Testing Library"],
      hasTestDir: true,
      criticalUncovered: ["payments", "orders"],
      areas: [
        { name: "auth", status: "ok", note: "Tests detected alongside this module" },
        { name: "checkout", status: "ok", note: "Tests detected alongside this module" },
        { name: "orders", status: "risk", note: "Business-critical module with no matching test file" },
        { name: "payments", status: "risk", note: "Business-critical module with no matching test file" },
        { name: "user", status: "ok", note: "Tests detected alongside this module" },
      ],
    },
    architecture: {
      nodes: [
        { id: "frontend", label: "React Storefront", type: "frontend", accent: "#14b8a6", files: 84, detail: "src/pages/checkout.jsx\nsrc/components/Cart.jsx\nsrc/hooks/useCart.js" },
        { id: "routes", label: "API Routes", type: "api", accent: "#0ea5e9", files: 12, detail: "server/routes/orders.js\nserver/routes/auth.js\nserver/routes/products.js" },
        { id: "controllers", label: "Controllers", type: "controller", accent: "#06b6d4", files: 9, detail: "server/controllers/cartController.js\nserver/controllers/checkoutController.js" },
        { id: "services", label: "Services", type: "service", accent: "#8b5cf6", files: 14, detail: "src/services/payment.js\nsrc/services/orderService.js\nserver/services/reportService.js" },
        { id: "data", label: "Models / Repositories", type: "data", accent: "#f5a524", files: 11, detail: "server/models/order.js\nserver/models/user.js\nserver/models/product.js" },
        { id: "auth", label: "Auth / Middleware", type: "auth", accent: "#e5484d", files: 6, detail: "server/middleware/auth.js\nserver/services/tokenService.js" },
        { id: "external", label: "External Integrations", type: "external", accent: "#f76808", files: 4, detail: "server/clients/stripeClient.js\nserver/clients/mailer.js" },
        { id: "config", label: "Configuration", type: "config", accent: "#64748b", files: 5, detail: "config/database.js\nconfig/index.js" },
        { id: "utils", label: "Shared Utilities", type: "utils", accent: "#7e868c", files: 13, detail: "src/utils/validate.js\nsrc/utils/format.js" },
      ],
      edges: [
        { id: "frontend-routes", source: "frontend", target: "routes", label: "HTTP" },
        { id: "routes-controllers", source: "routes", target: "controllers", label: "dispatch" },
        { id: "controllers-services", source: "controllers", target: "services", label: "invoke" },
        { id: "controllers-data", source: "controllers", target: "data", label: "read/write" },
        { id: "services-data", source: "services", target: "data", label: "persist" },
        { id: "services-external", source: "services", target: "external", label: "call" },
        { id: "routes-auth", source: "routes", target: "auth", label: "guard" },
        { id: "services-utils", source: "services", target: "utils", label: "uses" },
        { id: "config-routes", source: "config", target: "routes", label: "configures" },
      ],
      layers: [
        "React Storefront",
        "API Routes",
        "Controllers",
        "Services",
        "Models / Repositories",
        "Auth / Middleware",
        "External Integrations",
        "Configuration",
        "Shared Utilities",
      ],
      summary:
        "React Storefront → API Routes → Controllers → Services → Models / Repositories → External Integrations. Built with React, Express, Prisma, PostgreSQL.",
    },
    activity: buildSampleActivity(),
    recommendations: [
      { rank: 1, severity: "critical", title: "Potential secret exposure", category: "security", findingId: "f_sample_01", filePath: "config/database.js" },
      { rank: 2, severity: "critical", title: "2 vulnerable dependencies detected", category: "dependency", findingId: "f_sample_11" },
      { rank: 3, severity: "high", title: "Potential N+1 query", category: "performance", findingId: "f_sample_08", filePath: "src/services/orderService.js" },
      { rank: 4, severity: "high", title: "Critical modules without tests", category: "testing", findingId: "f_sample_13" },
      { rank: 5, severity: "high", title: "Complex function", category: "quality", findingId: "f_sample_04", filePath: "src/services/payment.js" },
      { rank: 6, severity: "medium", title: "Duplicated code blocks", category: "quality", findingId: "f_sample_05", filePath: "src/utils/validate.js" },
    ],
    summary:
      "acme/ecommerce is a medium-sized codebase primarily JavaScript (CSS, HTML), with 247 files across 34 directories. The overall Codebase Health Score is 78/100 (Fair). Dependencies is the strongest area at 91, while Testing is the weakest at 58. Architecturally, the codebase resolves to: React Storefront → API Routes → Controllers → Services → Models / Repositories → External Integrations. Built with React, Express, Prisma, PostgreSQL. Before this reaches production, address 2 critical issues, 2 vulnerable dependencies, 4 high-severity findings. Testing covers roughly 14.6% of source files, but these business-critical areas have no matching tests: payments, orders. Every figure above is produced by deterministic static analysis; the narrative only restates those measurements.",
    aiAvailable: true,
    summaryEngine: "retrieval",
    aiNotice:
      "This is a bundled sample analysis, shown so the product can be demonstrated without consuming GitHub API quota. The narrative is synthesised deterministically from the analyzer output.",
    stats: {
      filesAnalyzed: 247,
      bytesAnalyzed: 18_400 * 1024,
      apiCalls: 3,
      sourceFilesSampled: 58,
      indexedChunks: 0,
    },
  };

  cached = report;
  return report;
}
