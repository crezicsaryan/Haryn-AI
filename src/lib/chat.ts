import type { Category, Report } from "./types";
import { CATEGORIES } from "./constants";
import { gradeFor } from "./scoring";

export interface ChatAnswer {
  answer: string;
  sources: string[];
}

interface Intent {
  id: string;
  keywords: RegExp;
  build: (r: Report) => ChatAnswer;
}

function filesMatching(r: Report, re: RegExp, limit = 6): string[] {
  const set = new Set<string>();
  for (const f of r.findings) {
    if (f.filePath && re.test(f.filePath)) set.add(f.filePath);
  }
  if (set.size < limit) {
    for (const n of r.architecture.nodes) {
      for (const d of (n.detail ?? "").split("\n")) {
        if (d && re.test(d)) set.add(d);
      }
    }
  }
  return [...set].slice(0, limit);
}

function findingsFor(r: Report, category: Category, limit = 4) {
  return r.findings
    .filter((f) => f.category === category)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

const INTENTS: Intent[] = [
  {
    id: "auth",
    keywords: /\b(auth|authentication|authori[sz]ation|login|signin|sign-in|session|jwt|token|permission|guard)\b/i,
    build: (r) => {
      const files = filesMatching(r, /auth|login|session|jwt|guard|middleware|permission/i);
      const findings = files
        .map((p) => r.findings.find((f) => f.filePath === p))
        .filter(Boolean);
      const lines: string[] = [];
      if (files.length) {
        lines.push("Authentication-related files were located in the analysed tree:");
        files.forEach((f, i) => lines.push(`${i + 1}. ${f}`));
        lines.push(
          "These modules form the request-authentication path: credentials are validated, a session or token is issued, and middleware guards protected routes."
        );
      } else {
        lines.push(
          "No files with an obvious authentication name (auth/, login, session, jwt) were found in the analysed set. The project may delegate authentication to a framework, a hosted provider, or use different naming."
        );
      }
      if (findings.length) {
        lines.push(
          `Security findings touching these paths: ${findings
            .map((f) => f?.title)
            .slice(0, 3)
            .join("; ")}.`
        );
      }
      return { answer: lines.join("\n"), sources: files };
    },
  },
  {
    id: "database",
    keywords: /\b(database|db|connection|orm|model|schema|query|migration|persist|postgres|mongo|mysql|sql)\b/i,
    build: (r) => {
      const files = filesMatching(r, /model|schema|migration|db|database|repository|dao|prisma|entity/i);
      const tech = r.dependencies.items
        .filter((d) => /prisma|mongoose|sequelize|typeorm|pg|mysql|sqlite|knex|redis/i.test(d.name))
        .map((d) => d.name);
      const lines: string[] = [];
      if (tech.length) {
        lines.push(`Data-layer libraries detected: ${tech.join(", ")}.`);
      }
      if (files.length) {
        lines.push("Relevant files:");
        files.forEach((f, i) => lines.push(`${i + 1}. ${f}`));
      } else {
        lines.push(
          "No dedicated models/ or database configuration directory was identified from the file tree."
        );
      }
      const dataNode = r.architecture.nodes.find((n) => n.id === "data");
      if (dataNode) {
        lines.push(`The architecture pass classified ${dataNode.files} file(s) into the “${dataNode.label}” layer.`);
      }
      return { answer: lines.join("\n"), sources: files };
    },
  },
  {
    id: "payment",
    keywords: /\b(payment|checkout|billing|stripe|invoice|subscription|order)\b/i,
    build: (r) => {
      const files = filesMatching(r, /payment|checkout|billing|stripe|order|invoice/i);
      const lines = files.length
        ? [
            "Files related to payments / orders:",
            ...files.map((f, i) => `${i + 1}. ${f}`),
            "This is a high-blast-radius area — it should be covered by integration tests and reviewed closely for input handling.",
          ]
        : [
            "No payment or checkout modules were found in the analysed file set.",
          ];
      const rel = r.findings.filter(
        (f) => f.filePath && /payment|checkout|order/i.test(f.filePath)
      );
      if (rel.length) {
        lines.push(`Findings in this area: ${rel.map((f) => f.title).join("; ")}.`);
      }
      return { answer: lines.join("\n"), sources: files };
    },
  },
  {
    id: "testing",
    keywords: /\b(test|tests|testing|coverage|spec|jest|vitest|pytest|unit)\b/i,
    build: (r) => {
      const t = r.testing;
      const lines = [
        `Test files: ${t.testFiles}. Source files: ${t.sourceFiles}. Ratio: ${(t.ratio * 100).toFixed(1)}%.`,
        t.frameworks.length
          ? `Frameworks detected: ${t.frameworks.join(", ")}.`
          : "No test framework was detected in the manifests or test files.",
      ];
      if (t.criticalUncovered.length) {
        lines.push(
          `Business-critical modules without matching tests: ${t.criticalUncovered.join(", ")}.`
        );
      } else if (t.testFiles) {
        lines.push("Every business-critical domain identified has at least one matching test file.");
      }
      lines.push(
        "Note: this is an estimate derived from test-file presence, not a measured line-coverage report."
      );
      return { answer: lines.join("\n"), sources: [] };
    },
  },
  {
    id: "security",
    keywords: /\b(security|risk|risks|vulnerab|secret|credential|exposed|injection|xss|safe)\b/i,
    build: (r) => {
      const f = findingsFor(r, "security", 5);
      const vuln = r.dependencies.stat.vulnerable;
      const lines: string[] = [];
      if (!f.length && !vuln) {
        lines.push(
          "No security findings were produced by the static analyzers for this repository. That does not prove the absence of issues — it means no known patterns matched."
        );
      } else {
        lines.push(`The scan surfaced ${f.length} security finding(s)${vuln ? ` and ${vuln} vulnerable dependenc${vuln === 1 ? "y" : "ies"}` : ""}:`);
        f.forEach((x, i) =>
          lines.push(`${i + 1}. [${x.severity.toUpperCase()}] ${x.title}${x.filePath ? ` — ${x.filePath}${x.lineStart ? `:${x.lineStart}` : ""}` : ""}`)
        );
        lines.push(
          "Heuristic findings are labelled “potential” — confirm each one against the actual code before acting."
        );
      }
      return {
        answer: lines.join("\n"),
        sources: f.map((x) => x.filePath).filter(Boolean) as string[],
      };
    },
  },
  {
    id: "improve",
    keywords: /\b(improve|fix|first|priority|priorit|start|worst|biggest|important|action)\b/i,
    build: (r) => {
      const recs = r.recommendations;
      if (!recs.length) {
        return {
          answer:
            "No high or critical issues were detected, so there is no urgent action list. The next best step is to raise test coverage and keep dependencies current.",
          sources: [],
        };
      }
      const lines = ["Fix these in order — highest impact first:"];
      recs.forEach((rec) =>
        lines.push(
          `${rec.rank}. [${rec.severity.toUpperCase()}] ${rec.title}${rec.filePath ? ` (${rec.filePath})` : ""}`
        )
      );
      return {
        answer: lines.join("\n"),
        sources: recs.map((x) => x.filePath).filter(Boolean) as string[],
      };
    },
  },
  {
    id: "tech",
    keywords: /\b(technology|stack|framework|language|languages|built with|using|tech)\b/i,
    build: (r) => {
      const langs = r.languages
        .slice(0, 6)
        .map((l) => `${l.name} ${l.percent.toFixed(0)}%`)
        .join(", ");
      const deps = r.dependencies.items
        .filter((d) => d.type === "runtime")
        .slice(0, 8)
        .map((d) => d.name);
      const lines = [`Languages: ${langs || "not detected"}.`];
      if (deps.length) lines.push(`Key runtime dependencies: ${deps.join(", ")}.`);
      if (r.architecture.summary) lines.push(`Structure: ${r.architecture.summary}`);
      return { answer: lines.join("\n"), sources: [] };
    },
  },
  {
    id: "architecture",
    keywords: /\b(architecture|structure|layer|layers|flow|how does|how do|organized|organised|design|folder)\b/i,
    build: (r) => {
      const lines = [
        r.architecture.summary || "The structure could not be classified.",
        "",
        "Detected layers:",
        ...r.architecture.nodes.map((n) => `• ${n.label} — ${n.files} file(s)`),
      ];
      return { answer: lines.join("\n"), sources: [] };
    },
  },
  {
    id: "performance",
    keywords: /\b(performance|slow|n\+1|optimis|optimiz|speed|latency|cache|bottleneck)\b/i,
    build: (r) => {
      const f = findingsFor(r, "performance", 5);
      if (!f.length) {
        return {
          answer:
            "No performance heuristics fired on the analysed files. Static analysis can only flag patterns (loops with queries, blocking I/O); it cannot measure real runtime performance, which would require profiling.",
          sources: [],
        };
      }
      const lines = [
        `${f.length} potential performance issue(s) were flagged. These are static signals, not measured timings:`,
      ];
      f.forEach((x, i) =>
        lines.push(`${i + 1}. ${x.title}${x.filePath ? ` — ${x.filePath}${x.lineStart ? `:${x.lineStart}` : ""}` : ""}`)
      );
      return {
        answer: lines.join("\n"),
        sources: f.map((x) => x.filePath).filter(Boolean) as string[],
      };
    },
  },
  {
    id: "dependency",
    keywords: /\b(dependenc|dependencies|package|packages|npm|outdated|library|libraries|upgrade)\b/i,
    build: (r) => {
      const s = r.dependencies.stat;
      const lines = [
        `Total declared dependencies: ${s.total}. Healthy ${s.healthy}, outdated ${s.outdated}, vulnerable ${s.vulnerable}, potentially unused ${s.unused}.`,
      ];
      if (r.dependencies.manifests.length) {
        lines.push(`Manifests analysed: ${r.dependencies.manifests.join(", ")}.`);
      }
      const vuln = r.dependencies.items.filter((i) => i.status === "vulnerable").slice(0, 5);
      if (vuln.length) {
        lines.push("Vulnerable packages:");
        vuln.forEach((v) =>
          lines.push(`• ${v.name}@${v.version} → ${v.vulns?.map((x) => x.id).join(", ")}`)
        );
      }
      return { answer: lines.join("\n"), sources: r.dependencies.manifests };
    },
  },
];

function overview(r: Report): ChatAnswer {
  const grade = gradeFor(r.healthScore);
  return {
    answer: [
      `${r.repo.fullName} — health score ${r.healthScore}/100 (${grade.label}).`,
      r.summary,
    ].join("\n\n"),
    sources: [],
  };
}

export function answerQuestion(report: Report, question: string): ChatAnswer {
  const q = (question ?? "").trim();
  if (!q) return overview(report);

  for (const intent of INTENTS) {
    if (intent.keywords.test(q)) {
      const res = intent.build(report);
      if (res.answer.trim()) return res;
    }
  }

  // Fall back to the closest category by simple term overlap.
  const lower = q.toLowerCase();
  for (const cat of Object.keys(CATEGORIES) as Category[]) {
    if (lower.includes(cat)) {
      const f = findingsFor(report, cat, 5);
      if (f.length) {
        return {
          answer: `${CATEGORIES[cat].label}: ${f.length} finding(s).\n${f
            .map((x, i) => `${i + 1}. [${x.severity.toUpperCase()}] ${x.title}${x.filePath ? ` — ${x.filePath}` : ""}`)
            .join("\n")}`,
          sources: f.map((x) => x.filePath).filter(Boolean) as string[],
        };
      }
    }
  }

  return overview(report);
}

export const SUGGESTED_QUESTIONS = [
  "How does authentication work?",
  "What are the biggest security risks?",
  "Which files should I improve first?",
  "What technology is this project using?",
  "How is the project structured?",
  "Where is the database connection handled?",
];
