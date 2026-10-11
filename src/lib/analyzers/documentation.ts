import type { RawFinding, SourceFile } from "./types";
import type { Manifest } from "./dependencies";

export interface DocumentationResult {
  score: number;
  findings: RawFinding[];
  readmeBytes: number;
  commentRatio: number;
}

const COMMENT_LINE = /^\s*(\/\/|#|\*|\/\*|<!--)/;

export function analyzeDocumentation(args: {
  allPaths: string[];
  manifests: Manifest[];
  sourceFiles: SourceFile[];
}): DocumentationResult {
  const { allPaths, manifests, sourceFiles } = args;
  const findings: RawFinding[] = [];

  const readme = manifests.find((m) => /^readme(\.md|\.markdown|\.rst|\.txt)?$/i.test(m.path.split("/").pop() ?? ""));
  const readmeBytes = readme ? readme.content.length : 0;
  const hasReadme = Boolean(readme) || allPaths.some((p) => /(^|\/)readme(\.|$)/i.test(p));
  const hasLicense = allPaths.some((p) => /(^|\/)(licen[cs]e|copying)(\.|$)/i.test(p));
  const hasDocsDir = allPaths.some((p) => /(^|\/)(docs?|documentation)\//i.test(p));

  if (!hasReadme) {
    findings.push({
      category: "documentation",
      severity: "medium",
      title: "No README found",
      description:
        "The repository has no README. New contributors and reviewers have no entry point explaining what the project is or how to run it.",
      recommendation:
        "Add a README covering purpose, setup, environment variables, scripts and deployment.",
      impact: "Slower onboarding and repeated questions.",
      confidence: 0.9,
      source: "static-analysis",
    });
  } else if (readmeBytes > 0 && readmeBytes < 400) {
    findings.push({
      category: "documentation",
      severity: "low",
      title: "Minimal README",
      description: "The README exists but contains very little information.",
      filePath: readme?.path,
      evidence: `${readmeBytes} characters`,
      recommendation:
        "Document installation, configuration, usage examples and the project's architecture.",
      impact: "Contributors must reverse-engineer the setup.",
      confidence: 0.7,
      source: "static-analysis",
      isPotential: true,
    });
  }

  if (!hasLicense) {
    findings.push({
      category: "documentation",
      severity: "low",
      title: "No license file",
      description:
        "Without a license, the legal terms for using, modifying or distributing the code are undefined.",
      recommendation: "Add an explicit license (e.g. MIT, Apache-2.0) if the project is meant to be shared.",
      impact: "Ambiguous usage rights deter adoption and contribution.",
      confidence: 0.8,
      source: "static-analysis",
    });
  }

  // Comment density across analysed source files.
  let commentLines = 0;
  let totalLines = 0;
  for (const f of sourceFiles) {
    totalLines += f.lines.length;
    commentLines += f.lines.filter((l) => COMMENT_LINE.test(l)).length;
  }
  const commentRatio = totalLines ? commentLines / totalLines : 0;

  if (totalLines > 500 && commentRatio < 0.03) {
    findings.push({
      category: "documentation",
      severity: "low",
      title: "Sparse inline documentation",
      description: `Only ${(commentRatio * 100).toFixed(1)}% of analysed lines are comments. Complex logic may be difficult to follow.`,
      recommendation:
        "Add doc comments to public functions and explain non-obvious decisions rather than restating the code.",
      impact: "Higher cognitive load for future maintainers.",
      evidence: `${(commentRatio * 100).toFixed(1)}% comment density`,
      confidence: 0.55,
      source: "static-analysis",
      isPotential: true,
    });
  }

  if (!hasDocsDir && allPaths.length > 120) {
    findings.push({
      category: "documentation",
      severity: "info",
      title: "No dedicated docs directory",
      description: "For a project of this size, a docs/ directory would help organise longer-form documentation.",
      recommendation: "Create a docs/ folder for architecture notes, ADRs and guides.",
      impact: "Documentation tends to sprawl or go stale.",
      confidence: 0.5,
      source: "static-analysis",
      isPotential: true,
    });
  }

  // Documentation score: start at 100, subtract for each gap.
  let score = 100;
  if (!hasReadme) score -= 40;
  else if (readmeBytes < 400) score -= 18;
  if (!hasLicense) score -= 12;
  if (!hasDocsDir && allPaths.length > 120) score -= 8;
  if (commentRatio < 0.03 && totalLines > 500) score -= 14;
  else if (commentRatio < 0.06 && totalLines > 500) score -= 6;

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    findings,
    readmeBytes,
    commentRatio,
  };
}
