export interface SourceFile {
  path: string;
  content: string;
  lines: string[];
  language: string;
  bytes: number;
}

/** A finding before it is normalised (id/createdAt assigned by the pipeline). */
export interface RawFinding {
  category: import("../types").Category;
  severity: import("../types").Severity;
  title: string;
  description: string;
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  evidence?: string;
  impact?: string;
  recommendation: string;
  confidence: number;
  source: import("../types").FindingSource;
  isPotential?: boolean;
}

/** Redact a secret so reports never leak the real value. */
export function redact(value: string, keep = 4): string {
  const v = value.trim();
  if (v.length <= keep) return "•••";
  return `${v.slice(0, keep)}${"•".repeat(Math.min(24, v.length - keep))}`;
}

export function snippet(line: string, max = 160): string {
  const t = line.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
