# Haryn AI

**Understand. Diagnose. Improve Code.**

An AI-powered codebase intelligence platform. Paste a public GitHub repository URL and Haryn AI fetches, scans and reports on it — security, code quality, performance, architecture, testing, dependencies and documentation — producing a deterministic **Codebase Health Score** plus a prioritised action plan.

> **Core principle:** deterministic static analysis finds the facts; AI explains them.
> Haryn AI is *not* a chatbot that guesses whether your code is good.

---

## Status

V1 MVP, frontend + a real analysis engine running in Next.js route handlers.

| Area | State |
| --- | --- |
| Landing page | ✅ Built |
| Real GitHub fetch (metadata, languages, file tree) | ✅ Built |
| Static analyzers (7 categories) | ✅ Built |
| Deterministic health score | ✅ Built |
| Streaming analysis progress | ✅ Built |
| Report dashboard | ✅ Built |
| Architecture graph (React Flow) | ✅ Built |
| Repository-aware chat | ✅ Built |
| Retrieval index (BM25 + structural signals) | ✅ Built |
| Grounded answers with citations | ✅ Built |
| LLM summary + answers (optional key) | ✅ Built |
| Embedding blend (optional key) | ✅ Built |
| Export (JSON + print-to-PDF) | ✅ Built |
| Bundled sample report | ✅ Built |
| Database persistence (SQLite, portable SQL) | ✅ Built |
| Shareable report links + history | ✅ Built |
| Background job queue (Redis/BullMQ) | ⏳ Deferred — analysis runs in the request |

---

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000.

Two ways to use it:

1. **Live** — paste a public GitHub repository URL. The analyzer fetches it for real.
2. **Sample** — open http://localhost:3000/report/an_sample for a bundled, fully
   rendered report that needs no network access.

The database is created automatically on first connection — no server, no migration
step. Reports persist across restarts and are shareable by link. See
[Persistence](#persistence).

### No token required

Haryn AI fetches the repository as a **tarball from `codeload.github.com`** — a plain
CDN with **no rate limit** — rather than walking the REST API. One request returns
every file, so analyses work with zero configuration and full coverage.

The REST API is used only for *optional metadata* (stars, forks, licence, dates). If
it is rate-limited or unreachable, the metadata is derived from the archive instead
and the report shows a "metadata limited" chip — the analysis itself never fails.

Setting `GITHUB_TOKEN` therefore just enriches the header. See
[`.env.example`](./.env.example) for every supported variable.

---

## How the analysis works

```
POST /api/analyze  (NDJSON stream)
        │
        ├─ 1. Validate + normalise the URL          lib/validation.ts
        ├─ 2. Download the repo tarball (no rate limit)
        │     and unpack it in memory               lib/tarball.ts
        ├─ 3. Fetch metadata — best effort          lib/github.ts
        ├─ 4. Classify the file tree + detect
        │     languages
        ├─ 5. Rank every text file and pick the
        │     set worth scanning                    lib/analyzers/files.ts
        ├─ 6. Run the analyzers                     lib/analyzers/*
        ├─ 7. Normalise every finding               lib/analyze.ts
        ├─ 8. Compute category + health scores      lib/scoring.ts
        ├─ 9. Build recommendations                 lib/recommendations.ts
        ├─ 10. Chunk the code and build the
        │      retrieval index                      lib/ai/
        ├─ 11. Write the summary — LLM when
        │      configured, deterministic otherwise  lib/ai/summary.ts
        └─ 12. Emit the finished report
```

The client reads the stream and renders genuine staged progress, then routes to
`/report/[id]`.

`lib/tarball.ts` implements a small POSIX tar reader (ustar / GNU long names / pax
extended headers) over Node's built-in `gunzipSync`, with a decompressed-size cap as
a zip-bomb guard. Nothing is ever written to disk.

### Analyzers

| Analyzer | What it detects |
| --- | --- |
| `security.ts` | Known token formats (AWS, Stripe, GitHub, Google…), private keys, generic credential assignments, committed `.env` files, `eval`, dynamic `Function`, raw HTML injection, shell execution, SQL concatenation, permissive CORS, disabled TLS verification, unsafe deserialisation, weak hashes, non-crypto randomness |
| `quality.ts` | Oversized files/functions, estimated cyclomatic complexity, swallowed exceptions, TODO/FIXME markers, debug logging, cross-file duplication |
| `performance.ts` | Query-in-loop (N+1), sequential awaits in loops, nested loops, blocking sync I/O, whole-library imports, unbounded queries, oversized modules |
| `dependencies.ts` | Manifest parsing (npm, PyPI, Go, Cargo, Maven, Composer, Bundler), OSV advisory lookup, outdated packages (npm dist-tags), unused-package heuristic |
| `testing.ts` | Test-file detection, framework detection, test-to-source ratio, business-critical domains with no matching tests |
| `architecture.ts` | Layer inference, technology detection, relationship graph |
| `documentation.ts` | README/license/docs presence, comment density |

### Scoring

Each category starts at 100 and loses points per finding, where the penalty is
scaled by the finding's **confidence** and repeated findings of the same severity
have **diminishing returns** — so a hundred trivial nits can't outrank one critical
vulnerability.

```
security 20% · quality 20% · architecture 15% · performance 15%
testing 15% · dependencies 10% · documentation 5%
```

Heuristic findings are labelled **potential** in the UI, and every finding carries a
confidence value. See `lib/scoring.ts`.

---

## Retrieval & the AI layer

The report's chat is a **retrieval-augmented** system, not a chatbot with the
repository pasted into it.

```
Source files
     │
     ▼
 Chunking          declaration-aware: functions, classes, methods, Python defs;
                   leftover lines fall back to overlapping windows   ai/chunk.ts
     │
     ▼
 Indexing          BM25 inverted index over code-aware tokens        ai/bm25.ts
     │             (+ optional embedding vectors)                   ai/embeddings.ts
     ▼
 Retrieval         BM25  ×  symbol match  ×  path match  ×  import match
                   ×  exact phrase  ×  embedding cosine             ai/retrieve.ts
     │
     ▼
 Grounding         excerpts wrapped as untrusted data, delimiters
                   neutralised against prompt injection            ai/answer.ts
     │
     ▼
 Generation        LLM when configured ──┐
                   extractive otherwise ──┴─ both cited           ai/answer.ts
```

**It works with no API key.** Retrieval is a dependency-free, in-process BM25 index
plus structural signals, and answers are composed extractively from the retrieved
excerpts — still accurate, still cited, just less fluent. Adding `AI_API_KEY` upgrades
the summary and the answers to genuine LLM prose and adds a semantic embedding blend.

### Why hybrid, not pure embeddings

Questions about a codebase carry structural signal that term statistics miss —
a symbol name, the folder a file lives in, a module it imports. Those are cheap and
high-precision, so they are scored explicitly on top of BM25. Embeddings are a third
signal blended in when available, not the whole system.

### Prompt-injection defence

Repository files are untrusted input. A file may literally contain
*"ignore previous instructions"*. Excerpts are wrapped in `<repo_file>` tags, and any
tag-like sequence **inside** the content is neutralised first — otherwise a malicious
file could close the tag early and escape into the instruction channel. The system
prompt states that excerpt content is data, never instructions.

### Configuration

| Variable | Purpose |
| --- | --- |
| `AI_API_KEY` | Enables the LLM summary, fluent answers and embeddings |
| `AI_BASE_URL` | Any OpenAI-compatible endpoint (default OpenAI) |
| `AI_MODEL` | Chat model (default `gpt-4o-mini`) |
| `AI_EMBEDDING_MODEL` | Embedding model (default `text-embedding-3-small`) |
| `AI_EMBEDDINGS` | Set `off` to keep the LLM but skip embedding calls |

A missing key, a timeout or a 429 never breaks a report — the AI layer is an
enhancement, and every path degrades to the deterministic result (TRD §40).

---

## Persistence

Reports are stored in a database, so they survive a restart and are shareable by
link. The retrieval index is **not** stored — it is derived data, rebuilt in
memory from the persisted chunks on first use.

### No database server required

Local development uses SQLite through Node's **built-in** driver (`node:sqlite`,
Node 22.5+). No database server, no Docker, and **no native dependency to
install** — the file is created automatically at `data/haryn.db`.

```bash
npm install
npm run dev      # database created on first connection
```

### Switching to Postgres

Production is expected to run PostgreSQL. The DDL in `src/lib/db.ts` is written
in portable SQL for exactly that reason — two substitutions:

| SQLite | PostgreSQL |
| --- | --- |
| `TEXT` timestamps (ISO strings) | `TIMESTAMPTZ` |
| `TEXT` JSON columns | `JSONB` |

Then reimplement `src/lib/store.ts` against your driver of choice. **Nothing else
changes** — it is the only module that touches the database, and its public API
is already `async`, so even the call sites stay identical.

> A Prisma schema was written first, targeting Postgres as the TRD specifies.
> It was dropped because Prisma's install could not complete in the build
> environment (its `postinstall` spawns a child process, which is blocked here,
> and `latest` on npm currently resolves to an `8.0.0-rc` whose client does not
> match). Shipping a data layer that cannot boot is worse than shipping a
> simpler one that can, so the schema moved into portable SQL instead.

### What is stored

| Column | Why |
| --- | --- |
| `payload` | The complete `Report` document |
| `chunks` | Capped chunk set (400 chunks / 2 MB) so chat survives a restart |
| `health_score`, `finding_count`, `critical_count`, `file_count`, … | Denormalised so history is a single cheap query |

Reports are stored as **immutable documents** rather than normalised finding
rows. A report is a point-in-time snapshot, not live data — normalising it would
imply the findings mutate, and every read would need reassembling. The
denormalised scalar columns exist purely so the history list never has to
deserialise a payload.

`lib/db.ts` exposes a tolerant `parseJson` helper, because a SQLite driver hands
JSON columns back as strings while a Postgres driver would hand back parsed
objects. Never `JSON.parse(String(value))` — that throws the moment the driver
returns an object.

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
│       ├── analyze/route.ts        POST — streams progress + the report
│       ├── report/[id]/route.ts    GET  — a stored report
│       ├── chat/[id]/route.ts      GET/POST — transcript / repository Q&A
│       ├── recent/route.ts         GET  — history for the landing page
│       └── export/[id]/route.ts    GET  — JSON download
├── components/
│   ├── ui/                         Design system (Button, Card, ScoreRing, Aurora…)
│   ├── landing/                    Nav, AnalyzeForm, ReportPreview, history, sections
│   └── report/                     ReportView, FindingsList, ArchitectureGraph, ChatPanel
├── types/
│   └── node-sqlite.d.ts            Ambient types for Node's built-in SQLite
└── lib/
    ├── types.ts                    Shared domain model
    ├── constants.ts                Weights, severities, language colours, limits
    ├── validation.ts               URL parsing + SSRF hardening
    ├── tarball.ts                  Archive fetch + in-memory tar reader
    ├── github.ts                   GitHub API client (metadata only)
    ├── analyze.ts                  Pipeline orchestrator
    ├── analyzers/                  The seven analyzers
    ├── ai/                         Chunking, BM25 index, retrieval, LLM layer
    ├── db.ts                       Connection + portable DDL + tolerant JSON reader
    ├── store.ts                    The persistence seam
    ├── scoring.ts                  Deterministic score engine
    ├── chat.ts                     Report-only Q&A fallback (used by the sample)
    └── sample.ts                   Bundled sample report
```

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
focus rings, `prefers-reduced-motion` respected, severity never conveyed by colour
alone, and verified at 390 / 768 / 1440 px.

---

## API

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/analyze` | `{ repositoryUrl }` → NDJSON stream of `progress` / `result` / `error` events |
| `GET` | `/api/report/:id` | The completed report as JSON |
| `POST` | `/api/chat/:id` | `{ message }` → `{ answer, sources }` |
| `GET` | `/api/export/:id?format=json` | Download the report |

Errors use a consistent shape:

```json
{ "error": { "code": "REPOSITORY_NOT_FOUND", "message": "…" } }
```

Codes: `INVALID_URL`, `REPOSITORY_NOT_FOUND`, `PRIVATE_REPOSITORY`,
`REPOSITORY_TOO_LARGE`, `ANALYSIS_TIMEOUT`, `ANALYSIS_FAILED`, `RATE_LIMITED`.

---

## Security posture

Because Haryn AI processes untrusted source code:

- Only `github.com` hosts are accepted — the URL parser rejects credentials in the
  URL, non-standard ports and every other host (SSRF guard). Archive downloads are
  pinned to `codeload.github.com`.
- Repository code is never executed. There is no `npm install`, no build step, no
  script execution.
- The archive is unpacked in memory and never written to disk. Decompression is
  capped, so a zip bomb cannot exhaust memory.
- Secrets are **redacted** in reports — only a short prefix is ever displayed.
- Repository content is treated as data, never as instructions (prompt-injection
  resistant by construction, since the narrative layer only restates analyzer output).
- Per-IP rate limiting on analysis and chat.
- Configurable size, file-count and file-size limits.

---

## Scope decisions

**Persistence is done** — reports are stored via Prisma and survive restarts.

What remains deliberately deferred is the **background job queue** (Redis +
BullMQ). Analysis currently runs inside the HTTP request and streams progress
over NDJSON, which is why the `/analyze` page shows live staged progress rather
than polling a job. Moving it behind a queue is a transport swap, not a rewrite:
the pipeline is already asynchronous end-to-end, and `POST /api/analyze` is the
only caller of `runAnalysis`.

The one thing a queue would add that the current design cannot do is *surviving a
disconnect* — closing the tab mid-analysis abandons that run. The database row is
written up front with `status: "running"`, so the abandoned run is at least
visible in history rather than silently lost.

---

## Roadmap

- **V2** — GitHub OAuth, private repositories, history, commit comparison, continuous monitoring
- **V3** — PR reviews, webhooks, AI-generated patches, test generation, CI/CD integration
- **V4** — VS Code extension, team dashboards, organisation analytics, production log analysis

---

Analysis is advisory, not a security audit. Heuristic signals are labelled
"potential" — confirm each one against the actual code before acting.
