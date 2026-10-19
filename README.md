# Haryn AI

**Understand. Diagnose. Improve Code.**

Paste a public GitHub repository URL and Haryn AI fetches, parses and reports on it —
security, bugs, code quality, performance, architecture, testing, dependencies,
documentation and commit activity — producing a deterministic
**Codebase Health Score**, a prioritized action plan, an interactive
**codebase knowledge graph**, and a retrieval-grounded AI agent you can ask about
the code.

> **Core principle:** deterministic static analysis finds the facts; AI only explains
> them. Every claim in a report traces back to a measurement — Haryn AI is not a
> chatbot guessing whether your code is good.

---

## Quick start

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

Two ways to use it:

1. **Live** — paste a public GitHub repository URL. The analyzer fetches it for real.
2. **Sample** — open <http://localhost:3000/report/an_sample> for a bundled, fully
   rendered report that needs no network access at all.

No database server, no migration step, no API key required. The SQLite file is
created automatically at `data/haryn.db` on first connection — reports persist
across restarts and are shareable by link.

**No token required.** Repositories are fetched as a **tarball from
`codeload.github.com`** — a plain CDN with **no rate limit** — rather than by walking
the REST API. One request returns every file. `api.github.com` is used only for
*optional metadata*; when it is rate-limited or unreachable, metadata is derived from
the archive instead and the report shows a "metadata limited" chip. An analysis never
depends on the API being reachable.

See [`.env.example`](./.env.example) for every supported variable.

---

## Status

| Area | State |
| --- | --- |
| Landing page + repository history picker | ✅ Built |
| Real GitHub fetch (tarball archive + metadata) | ✅ Built |
| Static analyzers (8 categories) | ✅ Built |
| Deterministic health score | ✅ Built |
| Streaming analysis progress (NDJSON) | ✅ Built |
| Two-pane report dashboard (10 views + AI pane) | ✅ Built |
| Commit activity panel (52-week grid, contributors) | ✅ Built |
| Architecture graph — **2D + 3D** (toggle) | ✅ Built |
| Codebase knowledge graph — AST-built, **2D + 3D** | ✅ Built |
| Node details panel + change-impact analysis | ✅ Built |
| Repository-aware chat (BM25 + structural signals) | ✅ Built |
| Graph-aware chat (dependency / impact questions) | ✅ Built |
| Grounded answers with `path:line` citations | ✅ Built |
| **Bug diagnosis** — severity, evidence, impact, fix per finding | ✅ Built |
| Export (Markdown, JSON, print-to-PDF) | ✅ Built |
| SQLite persistence, shareable links, history | ✅ Built |
| Automated tests (271, Node built-in runner) | ✅ Built |
| Background job queue (Redis/BullMQ) | ⏳ Deferred — analysis runs in-request |
| GitHub OAuth / private repositories | ⏳ Deferred |

81 source files, ~21.8k lines of TypeScript.

---

## Everything built so far

### 1. Landing page

Repo URL field with an **inline history picker**: previously analysed repositories are
remembered and searchable, so a URL never has to be pasted twice. Keyboard navigable
(↑/↓ · Enter · Esc), with a one-click re-run per entry. The history list is grouped
**by repository, not by run** — analysing the same repo seven times shows one row with
a run count, produced by a single window-function query.

### 2. Streaming analysis

`POST /api/analyze` returns an **NDJSON stream**, and the `/analyze` page renders
genuine staged progress — including real download progress in megabytes — for 13
pipeline stages. Closing the tab abandons the run; the database row is written up
front with `status: "running"`, so an abandoned run stays visible in history.

### 3. Report dashboard — two panes

A view rail with **ten switchable views** plus a persistent **AI agent pane** beside
it (collapsing to a Report / AI agent switcher on mobile):

`Overview · Scores · Bugs · Findings · Activity · Architecture · Knowledge graph ·
Dependencies · Testing · AI summary · Actions`

### 4. Eight analyzers

| Analyzer | Finds |
| --- | --- |
| `security` | Known token formats (AWS, Stripe, GitHub, Google…), private keys, generic credential assignments, committed `.env` files, `eval`, dynamic `Function`, raw HTML injection, shell execution, SQL concatenation, permissive CORS, disabled TLS verification, unsafe deserialisation, weak hashes, non-crypto randomness |
| `bugs` | Off-by-one bounds, assignment in conditions, empty catches, unreachable code, `map`/`forEach` with `async`, mutation during iteration, `return` in `finally`, mutable Python defaults, `==` on Java strings |
| `quality` | Oversized files/functions, estimated cyclomatic complexity, swallowed exceptions, TODO/FIXME markers, debug logging, cross-file duplication, dead code |
| `performance` | Query-in-loop (N+1), sequential awaits in loops, nested loops, blocking sync I/O, whole-library imports, unbounded queries, oversized modules |
| `testing` | Test-file and framework detection, test-to-source ratio, business-critical domains with no matching tests |
| `dependencies` | Manifest parsing (npm, PyPI, Go, Cargo, Maven, Composer, Bundler), OSV advisory lookup, outdated packages via npm dist-tags, unused-package heuristic |
| `architecture` | Layer inference, technology detection, coupling and relationship graph |
| `documentation` | README/license/docs presence, comment density, discoverability |

**`bugs` is deliberately separate from `quality`.** Quality asks "is this hard to
maintain?"; bugs asks "is this wrong at runtime?". Bug rules are written for
**precision over recall** — each targets a construct that is almost always wrong,
carries an honest confidence value, and is labelled `potential` in the UI. A bug
finder that cries wolf gets ignored.

### 5. Deterministic scoring

Every category starts at 100 and loses points per finding. Penalties are scaled by
the finding's **confidence**, and repeated findings of the same severity have
**diminishing returns** — a hundred trivial nits cannot outrank one critical
vulnerability.

```
security 18% · bugs 15% · quality 15% · testing 13%
architecture 12% · performance 12% · dependencies 10% · documentation 5%
```

Two corrections worth knowing about, both found by testing against real repos:

- **Density normalisation is essential** (`clamp(sqrt(files/60), 1, 5)`) — without it
  every large repository scores near zero simply for being large.
- **Severity is intrinsic; volume is not.** `critical` is never normalised, `high` at
  half strength, `medium`/`low`/`info` fully. Normalising everything over-corrected,
  and a repo with two critical findings scored 92/100.

### 6. Commit activity

A 52-week commit grid, contributor split, momentum and recent commits with messages —
sourced from the GitHub REST API as an *optional enrichment*. GitHub's commit-stats
endpoint returns `202 Accepted` while it computes, so a miss is treated as "not
available yet" and surfaced as such rather than rendered as zeros.

### 7. Architecture graph — 2D and 3D

The same graph rendered two ways, with a user-facing toggle: **2D** via
`@xyflow/react` for tracing one exact edge through a dense area, and **3D** on a
plain canvas — hand-rolled rotation, perspective projection and depth sorting, with
**no 3D library dependency**.

### 8. Codebase knowledge graph

A second, complementary view: not "what is wrong" but "what is connected to what".

| | |
| --- | --- |
| **15 entity types** | repository, directory, file, function, class, interface, API endpoint, database model, database table, external package, test, environment variable, middleware, controller, service |
| **14 relationship types** | CONTAINS, IMPORTS, EXPORTS, DEFINES, CALLS, EXTENDS, IMPLEMENTS, USES, QUERIES, READS, WRITES, EXPOSES_ROUTE, TESTS, DEPENDS_ON |

**Built by parsing the source with the TypeScript compiler API** — never generated by
a language model. Every node traces to a real declaration with a line range; every
edge carries the evidence that justified it.

Three rules the design follows:

1. **Evidence only.** A node exists because a declaration was found. When a call
   cannot be resolved to exactly one declaration it is dropped rather than guessed —
   a graph with invented edges is worse than a sparse one.
2. **Confirmed vs inferred.** `import` statements, `extends` clauses and route
   registrations are *confirmed* — the syntax states them. Cross-file name resolution
   is *inferred*, and the UI draws those edges dashed.
3. **Bounded and honest.** Node and edge counts are capped and the cap is reported, so
   the UI says "showing a subset" rather than implying completeness.

**The 3D renderer is a concentric circular layout — and the layout is the meaning.**
One ring per level: repository → folders → files → declarations → interfaces/data.
Reading outward is reading the containment hierarchy. Shape encodes the entity class
(circle / square / diamond / hex) and colour the exact type, so *no distinction is
conveyed by colour alone*. Supporting details that took real work:

- **Label collision avoidance.** Labels are collected during the node pass, sorted by
  priority (selection > hover > neighbour > nearness > degree) and placed only where
  they do not overlap an already-placed box. A *missing* label beats overlapping text;
  essential labels are clamped inside the canvas rather than dropped.
- **`CONTAINS` edges are drawn at ~40% strength.** They are the most numerous and the
  least informative — at full strength they turn the graph into a web.
- **Fitting projects, it does not estimate.** The camera fits the real bounding box of
  every node projected at zoom 1, with an allowance for labels: perspective magnifies
  the near side, and a label like `POST /payment/create-order` reaches far past its
  node.
- **When the details panel overlays the canvas, the camera moves.** Selecting a node
  eases it to the centre of the unobstructed area; a pointer-down cancels the easing.

**Node details panel** — every node opens its type, file, line range, in/out
relationship counts and neighbours.

**Change impact analysis** — reverse-dependency traversal over incoming edges,
**excluding structural edges** (`CONTAINS`, `DEFINES`, `EXPORTS`). A file "containing"
a function is not a dependency, and following it would report the entire repository as
affected. Every result carries the relationship path that produced it, and the output
is labelled **potential** impact, never a guarantee.

Graph generation is **non-fatal**: if it fails, the failure is recorded on
`stats.error` and the report still completes.

### 9. Retrieval-grounded AI agent

```
Source files
     │
     ▼
 Chunking          declaration-aware: functions, classes, methods, Python defs;
                   leftover lines fall back to overlapping windows   ai/chunk.ts
     │
     ▼
 Indexing          BM25 inverted index over code-aware tokens        ai/bm25.ts
     ▼
 Retrieval         BM25 × symbol match × path match × import match
                   × exact phrase                                   ai/retrieve.ts
     │
     ▼
 Routing           findings / tests / routes / dependencies questions
                   answered from the report; graph questions answered by
                   traversing the knowledge graph                    ai/router.ts
     │
     ▼
 Evidence          findings on the matched files, joined to the rule
                   that produced each one                            ai/diagnose.ts
     │
     ▼
 Diagnosis         join the match to its findings, rule metadata,
                   call graph and coverage                        ai/diagnose.ts
     │
     ▼
 Answer            what it does · what is wrong · what breaks ·
                   how to fix · blast radius · how to verify
```

**There is no model in this path, by design.** A language model would make the
answer read better and be less trustworthy: it can state a plausible cause that the
analyzers never found, and the reader cannot tell. Every sentence here is either a
measurement from the report or a finding with a `path:line` behind it, so the answer
cannot invent a defect — and it says so when the evidence runs out.

Depth comes from using *more* of the evidence, not from fluency: the retrieved match
is joined to the findings on those exact files, each finding is expanded with the rule
that produced it, the impact it describes and a concrete repair, repeated defects are
collapsed into one root cause, and the import neighbourhood gives the blast radius.

**Structural signals, not just term frequency.** Questions about a codebase carry
signal that term statistics miss — a symbol name, the folder a file lives in, a module it
imports. Those are cheap and high-precision, so they are scored explicitly on top of
BM25. Two ranking details that were bugs before they were features: **stem keys**
(3–4 character prefixes) so "authentication" reaches `auth.js`, and an **exactness
prior** so a short config file cannot outrank the file that actually contains the
queried term.

**Prompt-injection defence.** Repository files are untrusted input — a file may
literally contain *"ignore previous instructions"*. Excerpts are wrapped in
`<repo_file>` tags, and any tag-like sequence **inside** the content is neutralised
first, otherwise a malicious file could close the tag early and escape into the
instruction channel.

### 10. Persistence

Reports are stored as **immutable documents** (a `payload` JSON snapshot), not
normalised finding rows — a report is a point-in-time snapshot, and normalising it
would imply the findings mutate. Denormalised scalar columns exist purely so the
history list never has to deserialise a payload.

A capped chunk set (400 chunks / 2 MB) is persisted so **repo-aware chat survives a
restart**; the BM25 index is derived data and is rebuilt from those chunks on demand.

Two constraints shaped the data layer:

- **Never open the database at module scope.** `next build` collects page data in 11
  parallel workers, and an eager connection races the file lock → `database is locked`.
  The connection is lazy.
- **The store API is async even though the driver is synchronous**, so a Postgres swap
  changes no call sites.

**Switching to Postgres.** The DDL in `src/lib/db.ts` is portable SQL — `TEXT`
timestamps become `TIMESTAMPTZ`, `TEXT` JSON columns become `JSONB`. Then reimplement
`src/lib/store.ts`, the only module that touches the database.

> A Prisma schema was written first, targeting Postgres as the TRD specifies. It was
> dropped because Prisma's install could not complete in this build environment (its
> `postinstall` spawns a child process, which is blocked, and `latest` then resolved to
> an `8.0.0-rc` whose client did not match). Shipping a data layer that cannot boot is
> worse than shipping a simpler one that can, so the schema moved into portable SQL.

### 11. Export

Markdown, JSON, or print-to-PDF from any report.

---

## How the analysis pipeline works

```
POST /api/analyze  (NDJSON stream)
        │
        ├─ 1.  Validate + normalise the URL              lib/validation.ts
        ├─ 2.  Download the repo tarball (no rate limit)
        │      and unpack it in memory                   lib/tarball.ts
        ├─ 3.  Metadata + commit activity — best effort  lib/github.ts
        ├─ 4.  Classify the file tree, detect languages
        ├─ 5.  Rank every text file and pick what to scan lib/analyzers/files.ts
        ├─ 6.  Run the analyzers                        lib/analyzers/*
        ├─ 7.  Parse files and build the knowledge graph lib/graph/extract.ts
        ├─ 8.  Normalise every finding                  lib/analyze.ts
        ├─ 9.  Compute category + health scores         lib/scoring.ts
        ├─ 10. Build recommendations                    lib/recommendations.ts
        ├─ 11. Chunk the code and build the index       lib/ai/
        ├─ 12. Synthesise the narrative summary         lib/ai/router.ts
        └─ 13. Persist the report and emit it           lib/store.ts
```

`lib/tarball.ts` implements a small POSIX tar reader (ustar / GNU long names / pax
extended headers) over Node's built-in `gunzipSync`, with a decompressed-size cap as a
zip-bomb guard. Nothing is ever written to disk.

**Coverage is measured, not guessed.** An earlier cap of 800 analysed files silently
covered 800 of a 3,509-file repository, so the limit was raised to 3,000 files / 64 MB,
selected round-robin by folder rather than by the first N paths. The archive download
budget is 180 s because a real repo in the test set is an 89 MB tarball that takes ~39 s
on a good connection — a 60 s budget aborted it whenever the link was slightly slower.

---

## Project structure

```
scripts/
├── shoot.js                        Playwright design screenshots
├── verify-live.js                  End-to-end analysis verification
└── verify-ai.js                    Retrieval + chat verification

src/
├── app/
│   ├── page.tsx                    Landing page
│   ├── analyze/page.tsx            Streaming progress view
│   ├── report/[id]/page.tsx        Report dashboard
│   └── api/
│       ├── analyze/route.ts                           POST — stream progress + report
│       ├── report/[id]/route.ts                       GET  — a stored report
│       ├── chat/[id]/route.ts                         GET/POST — transcript / repo Q&A
│       ├── history/route.ts                           GET  — repositories, grouped
│       ├── export/[id]/route.ts                       GET  — MD / JSON download
│       └── analysis/[id]/
│           ├── knowledge-graph/route.ts               GET  — the whole graph
│           ├── knowledge-graph/nodes/[nodeId]/route.ts
│           ├── knowledge-graph/neighbors/[nodeId]/route.ts
│           └── change-impact/route.ts                 POST — impact of a change
├── components/
│   ├── ui/                         Design system (Button, Card, ScoreRing, Aurora…)
│   ├── landing/                    Nav, AnalyzeForm, ReportPreview, RecentAnalyses
│   └── report/                     ReportView, FindingsList, ChatPanel,
│                                   ActivityPanel, ArchitectureGraph(+3D),
│                                   KnowledgeGraphView, KnowledgeGraph3D,
│                                   GraphDetailsPanel
├── types/node-sqlite.d.ts          Ambient types for Node's built-in SQLite
└── lib/
    ├── types.ts / constants.ts     Domain model · weights, severities, limits
    ├── validation.ts               URL parsing + SSRF hardening
    ├── tarball.ts                  Archive fetch + in-memory tar reader
    ├── github.ts                   GitHub API client (metadata, commit activity)
    ├── analyze.ts                  Pipeline orchestrator
    ├── analyzers/                  8 analyzers + file ranking
    ├── graph/                      AST parsing, extraction, storage, traversal, chat
    ├── ai/                         Chunking, BM25, retrieval, router, diagnosis
    ├── db.ts                       Lazy connection + portable DDL
    ├── store.ts                    The persistence seam
    ├── scoring.ts                  Deterministic score engine
    ├── markdown.ts                 Markdown export
    └── sample.ts                   Bundled sample report
```

---

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 16 (App Router), React 19, TypeScript | Streaming route handlers; one deployable |
| Styling | Tailwind v4 (`@theme` tokens, no config file) | Single source of design truth |
| Charts | Recharts + hand-rolled canvas | The 2D/3D graphs need no 3D library |
| Graph | `@xyflow/react` (2D), custom canvas (3D) | Perspective, depth sort, circular layout — dependency-free |
| Parsing | TypeScript Compiler API | Real AST, parse-only, never executes code |
| Database | **Node's built-in `node:sqlite`** | No server, no native module, no install |
| Retrieval | In-house BM25 | Zero dependencies, runs offline |
| Icons | `lucide-react` | — |
| Tests | Node's built-in test runner | No test framework dependency |

---

## Design system

Minimalism + Soft UI: a near-white canvas, organic pastel gradient blobs, a faint
blueprint grid, hairline borders, one teal accent and generous whitespace.

Tokens live in `src/app/globals.css` under `@theme` (Tailwind v4):

- **Ink** `#0a0f1c` · **Canvas** `#fbfcfd` · **Hairline** `#e9edf2`
- **Brand** teal `#14b8a6` → cyan `#06b6d4`
- **Severity** critical `#e5484d` · high `#f76808` · medium `#f5a524` · low `#0ea5e9`
- **Type** Inter (UI) · Plus Jakarta Sans (display) · Instrument Serif (wordmark) · JetBrains Mono (code)

Accessibility: SVG icons (never emoji), `cursor-pointer` on every control, visible
focus rings, `prefers-reduced-motion` respected, **severity never conveyed by colour
alone**, and layouts verified at 390 / 768 / 1440 px.

---

## API

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/analyze` | `{ repositoryUrl }` → NDJSON stream of `progress` / `result` / `error` |
| `GET` | `/api/report/:id` | The completed report as JSON |
| `GET`/`POST` | `/api/chat/:id` | Transcript / `{ message }` → `{ answer, sources }` |
| `GET` | `/api/history?q=&limit=` | Analysed repositories, grouped, newest first |
| `GET` | `/api/export/:id?format=md\|json` | Download the report |
| `GET` | `/api/analysis/:id/knowledge-graph` | The full graph for an analysis |
| `GET` | `/api/analysis/:id/knowledge-graph/nodes/:nodeId` | One node with metadata |
| `GET` | `/api/analysis/:id/knowledge-graph/neighbors/:nodeId` | In/out edges of a node |
| `POST` | `/api/analysis/:id/change-impact` | `{ nodeId, depth? }` → potentially affected nodes |

Errors use a consistent shape:

```json
{ "error": { "code": "REPOSITORY_NOT_FOUND", "message": "…" } }
```

Codes: `INVALID_URL`, `REPOSITORY_NOT_FOUND`, `PRIVATE_REPOSITORY`,
`REPOSITORY_TOO_LARGE`, `ANALYSIS_TIMEOUT`, `ANALYSIS_FAILED`, `RATE_LIMITED`.

---

## Security posture

Because Haryn AI processes untrusted source code:

- Only `github.com` hosts are accepted — the URL parser rejects credentials in the URL,
  non-standard ports and every other host (SSRF guard). Archive downloads are pinned to
  `codeload.github.com`.
- **Repository code is never executed.** No `npm install`, no build step, no script
  execution. AST parsing is parse-only.
- The archive is unpacked **in memory** and never written to disk; decompression is
  capped so a zip bomb cannot exhaust memory.
- Repository source is **never stored** — only the report, derived metrics and a
  capped chunk set used to answer questions.
- Secrets are **redacted** in reports — only a short prefix is ever displayed.
- Repository content is treated as **data, never instructions**.
- Per-IP rate limiting on analysis and chat; configurable size, file-count and
  file-size limits.

---

## Configuration

Everything is optional. Copy `.env.example` to `.env.local` and fill in what you need.

| Variable | Purpose |
| --- | --- |
| `DATABASE_FILE` | SQLite path (default `./data/haryn.db`) |
| `GITHUB_TOKEN` | Enriches report metadata (optional) |
| `MAX_REPOSITORY_SIZE_MB` / `MAX_FILES` / `MAX_FILE_SIZE_MB` | Analysis limits |
| `ANALYSIS_TIMEOUT_SECONDS` / `ARCHIVE_TIMEOUT_SECONDS` | Time budgets |
| `RATE_LIMIT_ANALYSIS` / `RATE_LIMIT_CHAT` | Requests per IP per hour |

A missing key, a timeout or a 429 never breaks a report — the AI layer is strictly
additive and every path degrades to the deterministic result.

---

## Development

```bash
npm run dev         # dev server (Turbopack)
npm run build       # production build
npm start           # serve the production build
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm test            # 54 tests, Node's built-in runner
npm run test:watch  # the same, in watch mode
```

`tsconfig.test.json` compiles `src/lib` to CommonJS into `.test-build/` (gitignored)
before the tests run, because Node's ESM resolver rejects the extensionless imports the
source uses.

**Automated tests — 54, all passing.** They cover node and relationship extraction, call
and import resolution, duplicate prevention, persistence, graph traversal, change
impact, malformed and empty input, invalid ids, and cross-analysis isolation (two
analyses sharing a node id must not overwrite each other — a bug the suite caught).

**Verified against real repositories**, not fixtures:

| Repository | Result |
| --- | --- |
| `crezicsaryan/gym-saathi` (26 files) | Health 87/100, 14 findings, graph of 86 nodes / 131 edges from 18 parsed files |
| `amzn/selling-partner-api-samples` (3,509 files) | Health 81/100, 1,100 findings, 3,000 files / 17.9 MB scanned in 45 s |

Harnesses live in `scripts/`: `verify-live.js` (analysis), `verify-ai.js` (retrieval and
chat), `shoot.js` (design screenshots).

---

## Scope: built vs deferred

**Built** — landing with repository history, streaming analysis, ten-view report
dashboard with a persistent AI pane, 8 analyzers, deterministic scoring, commit
activity, 2D/3D architecture graph, AST-built knowledge graph with node details and
change impact, graph-aware chat, hybrid retrieval, Markdown/JSON/PDF export, SQLite
persistence with shareable links, repository history, and 54 tests.

**Deferred**

- **Background job queue (Redis/BullMQ).** Analysis runs inside the HTTP request, so
  closing the tab abandons the run. The database row is written up front with
  `status: "running"`, so the abandoned run is at least visible. Moving it behind a
  queue is a transport swap, not a rewrite: the pipeline is already asynchronous
  end-to-end and `POST /api/analyze` is the only caller of `runAnalysis`.
- **More language parsers.** Only JavaScript/TypeScript are AST-parsed today. The parser
  registry (`lib/graph/parsers/index.ts`) is written for additional adapters; Python,
  Java and Go are the natural next ones.
- **GitHub OAuth and private repositories.**
- **Cross-repository analytics** — findings are stored as report snapshots, so "most
  common issue types across all repos" would need a normalised findings table.

---

## Roadmap

- **V2** — GitHub OAuth, private repositories, commit comparison, continuous monitoring
- **V3** — PR reviews, webhooks, AI-generated patches, test generation, CI/CD integration
- **V4** — VS Code extension, team dashboards, organisation analytics, production log analysis

---

_Findings are advisory, not a security audit. Heuristic signals are labelled
**potential** and carry a confidence value — confirm each one against the actual code
before acting._
