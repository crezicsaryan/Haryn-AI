import type {
  CategoryScore,
  Finding,
  LanguageStat,
  ProgressEvent,
  RepoActivity,
  RepoMeta,
  Report,
  Stage,
} from "./types";
import type { ParsedRepo } from "./validation";
import { fetchLanguages, fetchRepoActivity, fetchRepoMeta, GitHubError } from "./github";
import type { TreeEntry } from "./github";
import { fetchRepoArchive, type Archive } from "./tarball";
import {
  classifyFiles,
  languagesFromApi,
  languagesFromExtensions,
  selectAnalyzableFiles,
  sizeClassFor,
} from "./analyzers/files";
import { analyzeSecurity } from "./analyzers/security";
import { analyzeBugs } from "./analyzers/bugs";
import { analyzeQuality } from "./analyzers/quality";
import { analyzePerformance } from "./analyzers/performance";
import { analyzeTesting } from "./analyzers/testing";
import { analyzeDependencies, type Manifest } from "./analyzers/dependencies";
import { analyzeArchitecture } from "./analyzers/architecture";
import { analyzeDocumentation } from "./analyzers/documentation";
import type { RawFinding, SourceFile } from "./analyzers/types";
import { computeScores } from "./scoring";
import { buildRecommendations } from "./recommendations";
import { generateSummary } from "./summary";
import { buildIndex, generateAiSummary, aiStatus, type RepoIndex } from "./ai";
import { hashString, makeId } from "./utils";
import { LIMITS } from "./constants";
import { extractGraph, type ExtractResult as GraphExtractResult } from "./graph/extract";

export interface AnalysisResult {
  report: Report;
  /** Retrieval index for repo-aware Q&A. Held beside the report, not inside it. */
  index: RepoIndex;
  /**
   * Codebase knowledge graph. Absent when graph generation failed — that is a
   * degraded feature, not a failed analysis, so the report still stands.
   */
  graph?: GraphExtractResult;
}

const MANIFEST_BASENAMES = [
  "package.json",
  "requirements.txt",
  "pyproject.toml",
  "pipfile",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "go.mod",
  "cargo.toml",
  "composer.json",
  "gemfile",
  "setup.py",
  "setup.cfg",
  "readme.md",
  "readme",
  "readme.rst",
  "readme.txt",
];

type Emit = (e: ProgressEvent) => void;

function basename(path: string): string {
  return path.split("/").pop() ?? "";
}

/* ------------------------------------------------------------------ */
/* Metadata fallback                                                   */
/* ------------------------------------------------------------------ */

/**
 * Build repository metadata from the archive alone.
 * Used when the GitHub REST API is unavailable (e.g. the shared-IP rate limit)
 * so an analysis never fails just because it could not read star counts.
 */
function synthesizeMeta(repo: ParsedRepo, archive: Archive): RepoMeta {
  const read = (pred: (path: string) => boolean) =>
    archive.entries.find((e) => pred(e.path) && e.content != null)?.content ?? null;

  let description: string | null = null;
  let license: string | null = null;

  const pkg = read((p) => basename(p).toLowerCase() === "package.json");
  if (pkg) {
    try {
      const j = JSON.parse(pkg) as { description?: string; license?: string | { type?: string } };
      if (typeof j.description === "string" && j.description.trim()) {
        description = j.description.trim();
      }
      if (typeof j.license === "string") license = j.license;
      else if (j.license && typeof j.license === "object" && j.license.type) {
        license = j.license.type;
      }
    } catch {
      /* malformed package.json — ignore */
    }
  }

  if (!description) {
    const readme = read((p) => /^readme(\.md|\.markdown|\.rst|\.txt)?$/i.test(basename(p)));
    if (readme) {
      const line = readme
        .split("\n")
        .map((l) => l.trim())
        .find(
          (l) =>
            l &&
            !l.startsWith("#") &&
            !l.startsWith("![") &&
            !l.startsWith("<") &&
            !l.startsWith("[") &&
            !/^[-=*]{3,}$/.test(l)
        );
      if (line) description = line.slice(0, 240);
    }
  }

  if (!license && archive.entries.some((e) => /(^|\/)licen[cs]e(\.|$)/i.test(e.path))) {
    license = "See LICENSE";
  }

  return {
    owner: repo.owner,
    name: repo.name,
    fullName: `${repo.owner}/${repo.name}`,
    url: `https://github.com/${repo.owner}/${repo.name}`,
    description,
    defaultBranch: repo.ref || "HEAD",
    stars: 0,
    forks: 0,
    watchers: 0,
    openIssues: 0,
    license,
    sizeKb: Math.round(archive.totalBytes / 1024),
    createdAt: "",
    pushedAt: "",
    homepage: null,
    topics: [],
    archived: false,
    isFork: false,
    metaPartial: true,
  };
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

function normalize(raw: RawFinding[]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const r of raw) {
    const key = `${r.category}|${r.title}|${r.filePath ?? ""}|${r.lineStart ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: `f_${hashString(key)}`, ...r });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Pipeline                                                            */
/* ------------------------------------------------------------------ */

export async function runAnalysis(
  repo: ParsedRepo,
  emit: Emit,
  opts: { id?: string } = {}
): Promise<AnalysisResult> {
  const started = Date.now();
  // The caller may supply the id so it can record a "running" row up front.
  const id = opts.id ?? makeId("an");
  let apiCalls = 0;

  const done = (stage: Stage, label: string, pct: number) =>
    emit({ type: "progress", stage, label, status: "done", pct });
  const active = (stage: Stage, label: string, pct: number) =>
    emit({ type: "progress", stage, label, status: "active", pct });

  /* 1 — Fetch the repository archive (no API rate limit) -------------- */
  active("fetching", "Fetching repository", 4);

  // A large repository can take a while to download, so stream real progress
  // rather than leaving the user on a frozen "Fetching repository" label.
  let lastPct = 4;
  const archive = await fetchRepoArchive(
    repo.owner,
    repo.name,
    repo.ref || "HEAD",
    LIMITS.maxFileSizeKb * 1024,
    (received, total) => {
      const mb = received / 1024 / 1024;
      const label = total
        ? `Downloading repository — ${mb.toFixed(0)} of ${(total / 1024 / 1024).toFixed(0)} MB`
        : `Downloading repository — ${mb.toFixed(0)} MB`;
      // Keep the bar moving within the fetching stage (4% → 9%).
      const pct = total
        ? 4 + Math.min(5, (received / total) * 5)
        : Math.min(9, 4 + mb / 20);
      if (pct - lastPct >= 0.5) {
        lastPct = pct;
        active("fetching", label, Number(pct.toFixed(1)));
      }
    }
  );

  const sizeMb = archive.totalBytes / (1024 * 1024);
  if (sizeMb > LIMITS.maxRepoSizeMb) {
    throw new GitHubError(
      "REPOSITORY_TOO_LARGE",
      `This repository is ${sizeMb.toFixed(0)} MB, which exceeds the ${LIMITS.maxRepoSizeMb} MB analysis limit. Try a smaller repository.`
    );
  }

  /* Metadata is best-effort: never fail an analysis over star counts. */
  let meta: RepoMeta;
  try {
    const res = await fetchRepoMeta(repo.owner, repo.name);
    meta = res.meta;
    apiCalls += res.apiCalls;
  } catch {
    meta = synthesizeMeta(repo, archive);
  }

  /* Commit history is also best-effort — a rate limit must not fail the run. */
  let activity: RepoActivity | undefined;
  try {
    const res = await fetchRepoActivity(repo.owner, repo.name);
    activity = res.activity;
    apiCalls += res.apiCalls;
  } catch {
    activity = undefined;
  }

  done("fetching", "Repository fetched", 10);

  /* 2 — Structure ---------------------------------------------------- */
  active("discovering", "Analyzing file structure", 12);
  const treeEntries: TreeEntry[] = archive.entries.map((e) => ({
    path: e.path,
    type: "blob",
    size: e.bytes,
  }));
  const classified = classifyFiles(treeEntries);

  if (classified.fileCount > LIMITS.maxFiles) {
    throw new GitHubError(
      "REPOSITORY_TOO_LARGE",
      `This repository contains ${classified.fileCount.toLocaleString()} files, exceeding the ${LIMITS.maxFiles.toLocaleString()} file limit.`
    );
  }
  done("discovering", "File structure analyzed", 22);

  /* 3 — Languages ---------------------------------------------------- */
  active("languages", "Detecting languages", 24);
  let languages: LanguageStat[] = languagesFromExtensions(classified.allFiles);
  // The API gives authoritative byte counts when it is reachable.
  if (!meta.metaPartial) {
    try {
      const res = await fetchLanguages(repo.owner, repo.name);
      apiCalls += res.apiCalls;
      const fromApi = languagesFromApi(res.languages);
      if (fromApi.length) languages = fromApi;
    } catch {
      /* keep the archive-derived estimate */
    }
  }
  done("languages", "Languages detected", 30);

  /* 4 — Select what to scan ------------------------------------------ */
  const analyzable: SourceFile[] = selectAnalyzableFiles(
    archive.entries,
    LIMITS.analyzedFiles,
    LIMITS.analyzedBytes
  );

  const manifests: Manifest[] = archive.entries
    .filter(
      (e) =>
        e.content != null &&
        MANIFEST_BASENAMES.includes(basename(e.path).toLowerCase())
    )
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length)
    .slice(0, 40)
    .map((e) => ({ path: e.path, content: e.content as string }));

  const allPaths = classified.allFiles.map((f) => f.path);
  const bytesAnalyzed = analyzable.reduce((a, f) => a + f.bytes, 0);

  /* 5 — Dependencies ------------------------------------------------- */
  active("dependencies", "Analyzing dependencies", 36);
  const depResult = await analyzeDependencies({
    manifests,
    sourceFiles: analyzable,
  });
  done("dependencies", "Dependencies analyzed", 48);

  /* 6 — Security ----------------------------------------------------- */
  active("security", "Running security analysis", 50);
  const securityRaw = analyzeSecurity(analyzable);
  done("security", "Security analysis complete", 58);

  /* 7 — Bugs --------------------------------------------------------- */
  active("bugs", "Scanning for likely bugs", 59);
  const bugsRaw = analyzeBugs(analyzable);
  done("bugs", "Bug scan complete", 64);

  /* 8 — Quality ------------------------------------------------------ */
  active("quality", "Running code quality analysis", 65);
  const qualityRaw = analyzeQuality(analyzable);
  done("quality", "Code quality analysis complete", 71);

  /* 9 — Performance -------------------------------------------------- */
  active("performance", "Running performance analysis", 72);
  const performanceRaw = analyzePerformance(analyzable);
  done("performance", "Performance analysis complete", 78);

  /* 10 — Testing ----------------------------------------------------- */
  active("testing", "Analyzing test coverage", 80);
  const manifestText: Record<string, string> = {};
  for (const m of manifests) manifestText[m.path] = m.content;
  const testingResult = analyzeTesting({
    allPaths,
    sourceFiles: analyzable,
    manifestText,
  });
  done("testing", "Test coverage analyzed", 85);

  /* 10 — Architecture ------------------------------------------------ */
  active("architecture", "Extracting architecture", 87);
  const architecture = analyzeArchitecture({
    allPaths,
    manifests,
    sourceFiles: analyzable,
  });
  done("architecture", "Architecture extracted", 90);

  /* 11 — Knowledge graph ---------------------------------------------- */
  // Parses the files already in memory — no second fetch, no second read from
  // disk. A failure here is contained: the graph is one view of the report, so
  // losing it must not lose the analysis.
  active("graph", "Building knowledge graph", 91);
  let graph: GraphExtractResult | undefined;
  try {
    const graphFiles = analyzable.slice(0, LIMITS.graphMaxFiles);
    graph = extractGraph(id, graphFiles, allPaths, {
      maxNodes: LIMITS.graphMaxNodes,
      maxEdges: LIMITS.graphMaxEdges,
    });
    if (analyzable.length > graphFiles.length) {
      graph.stats.truncated = true;
    }
    done("graph", `Knowledge graph built — ${graph.stats.nodeCount} nodes`, 92);
  } catch (err) {
    graph = undefined;
    // Reported through the stage, not thrown: the rest of the report is valid.
    emit({
      type: "progress",
      stage: "graph",
      label: `Knowledge graph unavailable — ${
        err instanceof Error ? err.message : "generation failed"
      }`,
      status: "done",
      pct: 92,
    });
  }

  /* 12 — Documentation + scoring ------------------------------------- */
  active("scoring", "Calculating health score", 93);
  const docResult = analyzeDocumentation({
    allPaths,
    manifests,
    sourceFiles: analyzable,
  });

  const findings = normalize([
    ...securityRaw,
    ...bugsRaw,
    ...qualityRaw,
    ...performanceRaw,
    ...testingResult.findings,
    ...depResult.findings,
    ...docResult.findings,
  ]);

  const { scores, healthScore } = computeScores(
    findings,
    docResult.score,
    classified.fileCount
  );
  done("scoring", "Health score calculated", 95);

  /* 12 — Build the retrieval index ----------------------------------- */
  active("ai", "Indexing repository for retrieval", 96);
  const index = await buildIndex(analyzable, {
    // Embeddings are only attempted when a key is configured; failure is fine.
    withEmbeddings: aiStatus().embeddingsEnabled,
  });
  done("ai", "Repository indexed", 97);

  /* 13 — Assemble the report ----------------------------------------- */
  active("ai", "Generating AI report", 98);

  const structure = {
    fileCount: classified.fileCount,
    dirCount: classified.dirCount,
    totalBytes: classified.totalBytes,
    sizeClass: sizeClassFor(classified.totalBytes),
    topLevelDirs: classified.topLevelDirs.slice(0, 12),
    extensionCounts: classified.extensionCounts,
    truncated: false,
  };

  const report: Report = {
    id,
    createdAt: new Date(started).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    repo: meta,
    languages,
    structure,
    healthScore,
    scores,
    findings,
    dependencies: depResult.analysis,
    testing: testingResult.analysis,
    architecture,
    activity,
    graph: graph?.stats,
    recommendations: buildRecommendations(findings),
    summary: generateSummary({
      repo: meta,
      languages,
      structure,
      scores: scores as CategoryScore[],
      healthScore,
      findings,
      dependencies: depResult.analysis,
      testing: testingResult.analysis,
      architecture,
    }),
    summaryEngine: "retrieval",
    aiAvailable: true,
    aiNotice:
      "The narrative summary is synthesised deterministically from the analyzer output — it only restates measured facts and never invents issues.",
    stats: {
      filesAnalyzed: classified.fileCount,
      bytesAnalyzed,
      apiCalls,
      sourceFilesSampled: analyzable.length,
      indexedChunks: index.chunkCount,
    },
  };

  /* 14 — Upgrade the narrative with an LLM when one is configured ----- */
  const aiSummary = await generateAiSummary(report);
  report.summary = aiSummary.text;
  report.summaryEngine = aiSummary.engine;
  if (aiSummary.engine === "llm") {
    report.aiNotice =
      "The summary was written by a language model from the measured findings only — every claim traces back to the static analysis.";
  }
  done("ai", "AI report generated", 99);

  return { report, index, graph };
}
