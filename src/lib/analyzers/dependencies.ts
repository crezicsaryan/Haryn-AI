import type {
  DependencyAnalysis,
  DependencyItem,
  DependencyStatus,
} from "../types";
import type { RawFinding, SourceFile } from "./types";

/* ------------------------------------------------------------------ */
/* Manifest parsing                                                    */
/* ------------------------------------------------------------------ */

export interface Manifest {
  path: string;
  content: string;
}

type Ecosystem = "npm" | "PyPI" | "Go" | "crates.io" | "Maven" | "Packagist" | "RubyGems" | "NuGet";

interface ParsedDep {
  name: string;
  version: string;
  ecosystem: Ecosystem;
  type: string;
  /** OSV-compatible package name (Maven uses group:artifact). */
  osvName: string;
}

function cleanVersion(raw: string): string {
  if (!raw) return "";
  const v = raw
    .trim()
    .replace(/^[\^~>=<*\s]+/, "")
    .replace(/\.x$/i, ".0")
    .split(" ")[0]
    .split("||")[0]
    .trim();
  if (!v || /^(latest|next|\*|workspace:.*|file:.*|link:.*|git.*)$/i.test(v)) return "";
  return v;
}

export function parseManifests(manifests: Manifest[]): {
  deps: ParsedDep[];
  found: string[];
} {
  const deps: ParsedDep[] = [];
  const found: string[] = [];

  for (const m of manifests) {
    const base = m.path.split("/").pop()?.toLowerCase() ?? "";

    if (base === "package.json") {
      found.push(m.path);
      try {
        const j = JSON.parse(m.content) as Record<string, Record<string, string>>;
        for (const [key, type] of [
          ["dependencies", "runtime"],
          ["devDependencies", "dev"],
          ["peerDependencies", "peer"],
          ["optionalDependencies", "optional"],
        ] as const) {
          for (const [name, version] of Object.entries(j[key] ?? {})) {
            deps.push({
              name,
              version: cleanVersion(String(version)),
              ecosystem: "npm",
              type,
              osvName: name,
            });
          }
        }
      } catch {
        /* malformed manifest — skip */
      }
    }

    if (base === "requirements.txt" || base.endsWith(".requirements.txt")) {
      found.push(m.path);
      for (const line of m.content.split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#") || t.startsWith("-")) continue;
        const m2 = /^([A-Za-z0-9._-]+)\s*(?:\[[^\]]*\])?\s*(?:==|>=|<=|~=|!=|>|<)?\s*([^\s;#]*)/.exec(t);
        if (!m2) continue;
        deps.push({
          name: m2[1],
          version: cleanVersion(m2[2] ?? ""),
          ecosystem: "PyPI",
          type: "runtime",
          osvName: m2[1],
        });
      }
    }

    if (base === "go.mod") {
      found.push(m.path);
      const re = /^\s*([a-z0-9.\-/]+\.[a-z]{2,}[^\s]*)\s+(v[0-9][^\s]*)/gim;
      let mm: RegExpExecArray | null;
      while ((mm = re.exec(m.content))) {
        deps.push({
          name: mm[1],
          version: mm[2].replace(/^v/, ""),
          ecosystem: "Go",
          type: "runtime",
          osvName: mm[1],
        });
      }
    }

    if (base === "cargo.toml") {
      found.push(m.path);
      const re = /^\s*([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")/gim;
      let mm: RegExpExecArray | null;
      while ((mm = re.exec(m.content))) {
        const v = mm[2] ?? mm[3] ?? "";
        deps.push({
          name: mm[1],
          version: cleanVersion(v),
          ecosystem: "crates.io",
          type: "runtime",
          osvName: mm[1],
        });
      }
    }

    if (base === "pom.xml") {
      found.push(m.path);
      const re =
        /<dependency>[\s\S]*?<groupId>([^<]+)<\/groupId>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?(?:<version>([^<]+)<\/version>)?[\s\S]*?<\/dependency>/g;
      let mm: RegExpExecArray | null;
      while ((mm = re.exec(m.content))) {
        deps.push({
          name: `${mm[1]}:${mm[2]}`,
          version: cleanVersion(mm[3] ?? ""),
          ecosystem: "Maven",
          type: "runtime",
          osvName: `${mm[1]}:${mm[2]}`,
        });
      }
    }

    if (base === "composer.json") {
      found.push(m.path);
      try {
        const j = JSON.parse(m.content) as Record<string, Record<string, string>>;
        for (const [name, version] of Object.entries(j.require ?? {})) {
          deps.push({
            name,
            version: cleanVersion(String(version)),
            ecosystem: "Packagist",
            type: "runtime",
            osvName: name,
          });
        }
      } catch {
        /* ignore */
      }
    }

    if (base === "gemfile") {
      found.push(m.path);
      const re = /^\s*gem\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/gim;
      let mm: RegExpExecArray | null;
      while ((mm = re.exec(m.content))) {
        deps.push({
          name: mm[1],
          version: cleanVersion(mm[2] ?? ""),
          ecosystem: "RubyGems",
          type: "runtime",
          osvName: mm[1],
        });
      }
    }
  }

  // De-duplicate by ecosystem+name+type.
  const map = new Map<string, ParsedDep>();
  for (const d of deps) {
    const k = `${d.ecosystem}:${d.name}:${d.type}`;
    if (!map.has(k)) map.set(k, d);
  }

  return { deps: [...map.values()], found: [...new Set(found)] };
}

/* ------------------------------------------------------------------ */
/* OSV vulnerability lookup                                            */
/* ------------------------------------------------------------------ */

interface OsvVuln {
  id: string;
  summary?: string;
  database_specific?: { severity?: string };
  severity?: { type: string; score: string }[];
}

async function queryOsv(deps: ParsedDep[]): Promise<Map<string, OsvVuln[]>> {
  const out = new Map<string, OsvVuln[]>();
  // OSV batch endpoint accepts up to 1000 queries; cap for safety.
  const targets = deps.slice(0, 200);
  if (!targets.length) return out;

  const queries = targets.map((d) => ({
    package: { name: d.osvName, ecosystem: d.ecosystem },
    ...(d.version ? { version: d.version } : {}),
  }));

  try {
    const res = await fetch("https://api.osv.dev/v1/querybatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return out;
    const j = (await res.json()) as { results?: { vulns?: OsvVuln[] }[] };
    (j.results ?? []).forEach((r, i) => {
      if (r?.vulns?.length) {
        out.set(`${targets[i].ecosystem}:${targets[i].name}`, r.vulns);
      }
    });
  } catch {
    /* OSV unreachable — dependency security is best-effort */
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* "Latest version" lookup (npm only, bounded)                         */
/* ------------------------------------------------------------------ */

async function fetchNpmLatest(names: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const targets = names.slice(0, 12);
  await Promise.all(
    targets.map(async (name) => {
      try {
        const res = await fetch(
          `https://registry.npmjs.org/-/package/${encodeURIComponent(name)}/dist-tags`,
          { cache: "no-store", signal: AbortSignal.timeout(6_000) }
        );
        if (!res.ok) return;
        const j = (await res.json()) as { latest?: string };
        if (j.latest) out.set(name, j.latest);
      } catch {
        /* ignore */
      }
    })
  );
  return out;
}

function parseSemver(v: string): number[] | null {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

function isOutdated(current: string, latest: string): boolean {
  const a = parseSemver(current);
  const b = parseSemver(latest);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (b[i] > a[i]) return true;
    if (b[i] < a[i]) return false;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

export interface DependencyResult {
  analysis: DependencyAnalysis;
  findings: RawFinding[];
}

export async function analyzeDependencies(args: {
  manifests: Manifest[];
  sourceFiles: SourceFile[];
}): Promise<DependencyResult> {
  const { manifests, sourceFiles } = args;
  const { deps, found } = parseManifests(manifests);

  const corpus = sourceFiles.map((f) => f.content).join("\n");

  const [osv, npmLatest] = await Promise.all([
    queryOsv(deps),
    fetchNpmLatest(deps.filter((d) => d.ecosystem === "npm" && d.type !== "peer").map((d) => d.name)),
  ]);

  const items: DependencyItem[] = deps.map((d) => {
    const vulns = osv.get(`${d.ecosystem}:${d.name}`);
    let status: DependencyStatus = "healthy";

    if (vulns?.length) {
      status = "vulnerable";
    } else {
      const latest = npmLatest.get(d.name);
      if (latest && d.version && isOutdated(d.version, latest)) {
        status = "outdated";
      } else if (d.ecosystem === "npm" && d.type !== "peer" && !d.name.startsWith("@types/")) {
        // Unused heuristic — only trust it when we sampled a reasonable slice.
        const bare = d.name.startsWith("@") ? d.name : d.name.split("/")[0];
        const referenced =
          corpus.includes(`"${d.name}"`) ||
          corpus.includes(`'${d.name}'`) ||
          corpus.includes(`"${bare}`) ||
          corpus.includes(`'${bare}`);
        if (!referenced && sourceFiles.length >= 8) status = "unused";
        else status = "healthy";
      }
    }

    return {
      name: d.name,
      version: d.version || "—",
      ecosystem: d.ecosystem,
      type: d.type,
      status,
      vulns: vulns?.map((v) => ({
        id: v.id,
        summary: v.summary ?? "Known vulnerability",
        severity: v.database_specific?.severity,
      })),
    };
  });

  const stat = {
    total: items.length,
    healthy: items.filter((i) => i.status === "healthy").length,
    outdated: items.filter((i) => i.status === "outdated").length,
    vulnerable: items.filter((i) => i.status === "vulnerable").length,
    unused: items.filter((i) => i.status === "unused").length,
    unknown: items.filter((i) => i.status === "unknown").length,
  };

  const findings: RawFinding[] = [];

  const vulnerable = items.filter((i) => i.status === "vulnerable");
  if (vulnerable.length) {
    const worst = vulnerable.slice(0, 5);
    findings.push({
      category: "dependency",
      severity: vulnerable.length >= 3 ? "critical" : "high",
      title: `${vulnerable.length} vulnerable dependenc${vulnerable.length === 1 ? "y" : "ies"} detected`,
      description:
        "One or more packages have advisories published in the OSV database. Each entry below links a package to a known issue.",
      evidence: worst
        .map((v) => `${v.name}@${v.version} → ${v.vulns?.map((x) => x.id).join(", ")}`)
        .join("\n"),
      impact:
        "Known vulnerabilities are directly exploitable in some cases and are trivially discoverable by scanners.",
      recommendation:
        "Upgrade the affected packages to a patched version, or pin a safe alternative. Re-run the scan after upgrading.",
      confidence: 0.85,
      source: "dependency-scanner",
    });
  }

  if (stat.outdated >= 3) {
    findings.push({
      category: "dependency",
      severity: stat.outdated >= 8 ? "medium" : "low",
      title: `${stat.outdated} outdated dependencies`,
      description:
        "Several packages are behind their latest published release, missing bug fixes and security patches.",
      evidence: items
        .filter((i) => i.status === "outdated")
        .slice(0, 6)
        .map((i) => `${i.name}@${i.version}`)
        .join("\n"),
      impact: "Accumulating drift makes future upgrades riskier.",
      recommendation:
        "Schedule regular dependency updates (e.g. Dependabot/Renovate) and review changelogs before merging.",
      confidence: 0.75,
      source: "dependency-scanner",
      isPotential: true,
    });
  }

  if (stat.unused >= 3) {
    findings.push({
      category: "dependency",
      severity: "low",
      title: `${stat.unused} potentially unused dependencies`,
      description:
        "These packages are declared in a manifest but were not referenced in the analysed source files.",
      evidence: items
        .filter((i) => i.status === "unused")
        .slice(0, 8)
        .map((i) => i.name)
        .join(", "),
      impact: "Unnecessary install size, slower builds and a wider attack surface.",
      recommendation:
        "Confirm they are unused and remove them, or move build-only packages to devDependencies.",
      confidence: 0.45,
      source: "dependency-scanner",
      isPotential: true,
    });
  }

  if (stat.total > 60) {
    findings.push({
      category: "dependency",
      severity: "low",
      title: "Large dependency footprint",
      description: `The project declares ${stat.total} dependencies. Each additional package increases maintenance and supply-chain risk.`,
      impact: "Harder to audit and keep current.",
      recommendation: "Periodically review the dependency list and remove anything not earning its place.",
      confidence: 0.6,
      source: "dependency-scanner",
      isPotential: true,
    });
  }

  if (!found.length) {
    findings.push({
      category: "dependency",
      severity: "info",
      title: "No dependency manifest found",
      description:
        "No recognised package manifest (package.json, requirements.txt, go.mod, …) was detected, so dependency analysis was skipped.",
      recommendation: "If the project has dependencies, ensure the manifest is committed at the repository root.",
      confidence: 0.8,
      source: "dependency-scanner",
    });
  }

  return { analysis: { stat, items, manifests: found }, findings };
}
