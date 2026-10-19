# Haryn AI — Project Summary

Paste a public GitHub repository URL, get an evidence-based codebase health
report: architecture, security, bugs, dependencies, tests, commit activity, and a
retrieval-grounded AI agent you can ask about the code.

**Core principle:** deterministic static analysis finds the facts; AI only
explains them. Every claim in a report traces back to a measurement.

---

## What it does

| Surface | What you get |
| --- | --- |
| **Landing** | Paste a repo URL, or open the bundled sample. Recent analyses listed from the database. |
| **Analysis** | Live staged progress streamed over NDJSON — including real download progress in megabytes. |
| **Report** | Ten switchable views (Overview, Scores, Bugs, Findings, Activity, Architecture, Dependencies, Testing, AI summary, Actions) with a persistent AI agent beside them. |
| **Architecture** | The same graph in **2D** (React Flow, clickable nodes) or **3D** (canvas, drag to rotate). |
| **Activity** | Commit grid for the last 52 weeks, contributor split, momentum, recent commits. |
| **Bugs** | Constructs that behave incorrectly at runtime, separate from code-quality smells. |
| **AI agent** | Ask questions; answers are retrieved from the actual source and cite `path:line`. |
| **Export** | Markdown, JSON, or print-to-PDF. |

---

## Architecture

```
Browser
  │
  ├─ POST /api/analyze ──────────────────────────────────────────────┐
  │    streams progress, then the report                             │
  │                                                                  │
  └─ GET  /report/[id]  ←────────── SQLite ──────────────────────────┘
       GET  /api/chat/[id]              (data/haryn.db)
       GET  /api/recent
       GET  /api/export/[id]?format=md|json
```

### The analysis pipeline

```
1.  Validate + normalise the URL                    lib/validation.ts
2.  Download the repo tarball (no rate limit)       lib/tarball.ts
3.  Metadata + commit activity — best effort        lib/github.ts
4.  Classify the file tree, detect languages
5.  Rank files and pick what to scan                lib/analyzers/files.ts
6.  Run the analyzers                               lib/analyzers/*
7.  Chunk the code, build the retrieval index       lib/ai/
8.  Normalise findings, score, recommend, summarise
9.  Persist the report + capped chunks              lib/store.ts
```

### Two design decisions worth calling out

**Repositories come from the tarball CDN, not the REST API.**
`codeload.github.com` has no rate limit and returns every file in one request.
`api.github.com` (60 requests/hour unauthenticated) is used only for *optional*
metadata and commit history. If it is rate-limited, the analysis still completes
and the report says what is missing.

**There is no AI layer.** Every sentence the assistant produces is either a
measurement from the analysis or a finding with a `path:line` behind it, so it
cannot invent a defect. Depth comes from joining the retrieved code to its
findings, the rule metadata behind them, the import graph and the coverage data
— not from a model's fluency.

---

## The analyzers

| Analyzer | Finds |
| --- | --- |
| `security` | Committed secrets, injection risk, unsafe configuration |
| `bugs` | Off-by-one bounds, assignment in conditions, empty catches, unreachable code, `map`/`forEach` with `async`, mutation during iteration, `return` in `finally`, mutable Python defaults, `==` on Java strings |
| `quality` | Complexity, function/file size, duplication, dead code |
| `performance` | N+1 queries, blocking calls, nested loops |
| `testing` | Coverage gaps, untested critical modules |
| `dependencies` | Outdated and vulnerable packages (OSV advisories) |
| `architecture` | Layer inference and coupling |
| `documentation` | README, comments, discoverability |

Bug rules are written for **precision over recall** — each targets a construct
that is almost always wrong, carries an honest confidence value, and is labelled
`potential` in the UI. A bug finder that cries wolf gets ignored.

---

## Retrieval & the AI layer

```
Source files → declaration-aware chunking → BM25 index
   → hybrid retrieval → intent routing → evidence-backed diagnosis
```

- **Hybrid retrieval**: BM25 × symbol match × path match × import match × exact
  phrase. Code questions carry structural signal that term statistics miss.
- **Stem keys** (3–4 character prefixes) so "authentication" reaches `auth.js`.
- **Exactness prior** so a short config file cannot outrank the file that
  actually contains the queried term.
- **Intent routing** so "what should I fix" answers from findings, not code
  search.
- **Bug diagnosis**: each finding is expanded with the rule that produced it,
  the impact it describes and a concrete repair, with repeated defects collapsed
  into one root cause.

Works with **no configuration at all** — there is no key to set, because nothing
leaves the machine.

---

## Codebase knowledge graph

A second, complementary view of the repository: not "what is wrong" but "what is
connected to what".

**Built by parsing the source with the TypeScript compiler API** — never
generated. Every node traces to a real declaration with a line range; every edge
carries the evidence that justified it.

| | |
| --- | --- |
| **Entities** | repository, directory, file, function, class, interface, API endpoint, database model/table, external package, test, environment variable, middleware, controller, service |
| **Relationships** | CONTAINS, IMPORTS, EXPORTS, DEFINES, CALLS, EXTENDS, IMPLEMENTS, USES, QUERIES, READS, WRITES, EXPOSES_ROUTE, TESTS, DEPENDS_ON |

### Three rules the design follows

1. **Evidence only.** A node exists because a declaration was found. When a call
   cannot be resolved to exactly one declaration it is dropped rather than
   guessed — a graph with invented edges is worse than a sparse one.
2. **Confirmed vs inferred.** `import` statements, `extends` clauses and route
   registrations are *confirmed* — the syntax states them. Cross-file name
   resolution is *inferred*, and the UI draws those edges dashed.
3. **Bounded.** Node and edge counts are capped and the cap is reported, so the
   UI says "showing a subset" rather than implying completeness.

### Storage

Two tables (`graph_nodes`, `graph_edges`) in the existing database. A graph
database would be operational weight for no benefit — the queries this needs are
bounded traversals within one analysis, which indexed joins answer directly.
Node ids are scoped by a composite `(analysis_id, id)` primary key, which makes
cross-analysis isolation structural rather than a property of how ids happen to
be generated.

### Change impact

Reverse-dependency traversal over incoming edges, excluding structural edges
(`CONTAINS`, `DEFINES`, `EXPORTS`) — a file "containing" a function is not a
dependency, and following it would report the entire repository as affected.
Every result carries the relationship path that produced it, and the output is
labelled **potential** impact, never a guarantee.

### Graph-aware chat

Questions like *"what depends on the payment service"*, *"which routes use the
User model"* or *"what breaks if I change this function"* are resolved by
traversing the graph before the retrieval pipeline runs. It returns `null` for
anything else, so the existing RAG path is untouched — the graph extends the
chat rather than replacing it. Answers cite `path:line` and say plainly when the
graph lacks the information.

---

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 16 (App Router), React 19, TypeScript | Streaming route handlers; one deployable |
| Styling | Tailwind v4 (`@theme` tokens, no config file) | Single source of design truth |
| Charts | Recharts + hand-rolled canvas | 2D/3D architecture graph needs no 3D library |
| Graph | `@xyflow/react` (2D), custom canvas (3D) | Dependency-free 3D: rotation + perspective + depth sort |
| Database | **Node's built-in `node:sqlite`** | No server, no native module, no install |
| Retrieval | In-house BM25 | Zero dependencies; runs offline |
| Icons | `lucide-react` | — |

---

## Running it

```bash
npm install
npm run dev
```

Open http://localhost:3000. The database is created automatically at
`data/haryn.db` — no server, no migration step.

Optional environment variables are documented in `.env.example`. Only
`GITHUB_TOKEN` (richer metadata) changes behaviour, and it is not required.

### Switching to Postgres

The DDL in `src/lib/db.ts` is portable SQL — `TEXT` timestamps become
`TIMESTAMPTZ`, `TEXT` JSON columns become `JSONB`. Then reimplement
`src/lib/store.ts`, which is the only module that touches the database. Its API
is already `async`, so call sites do not change.

---

## Scope: built vs deferred

**Built**

- Landing, streaming analysis, report dashboard
- 8 analyzers with a deterministic scoring engine
- 2D + 3D architecture graph
- Commit activity and contributors
- Retrieval index (BM25 + structural signals) and a grounded AI agent
- Markdown / JSON / PDF export, shareable links, analysis history
- Database persistence with SQLite

**Deferred**

- **Background job queue (Redis/BullMQ).** Analysis runs inside the HTTP
  request, so closing the tab abandons the run. The database row is written up
  front with `status: "running"`, so the abandoned run is at least visible.
- **GitHub OAuth and private repositories.**
- **Cross-repository analytics** — findings are stored as report snapshots, not
  normalised rows, so "most common issue types across all repos" would need a
  findings table.

---

## Verification

The project is verified against real repositories rather than fixtures:

| Repository | Result |
| --- | --- |
| `crezicsaryan/gym-saathi` (26 files) | Health 87/100, 14 findings, graph of 86 nodes / 131 edges from 18 parsed files |
| `amzn/selling-partner-api-samples` (3,509 files) | Health 81/100, 1,100 findings, 3,000 files / 17.9 MB scanned in 45 s |

Harnesses live in `scripts/`: `verify-live.js` (analysis), `verify-ai.js`
(retrieval and chat), `shoot.js` (design screenshots).

**Automated tests** — `npm test` runs 54 tests with Node's built-in runner
(no test framework dependency; `tsconfig.test.json` compiles to CommonJS so the
runner can load it). They cover node and relationship extraction, call and
import resolution, duplicate prevention, persistence, traversal, change impact,
malformed and empty input, invalid ids, and cross-analysis isolation.

---

_Findings are advisory. Heuristic signals are labelled **potential** and carry a
confidence value — treat a report as a starting point, not a security audit._
