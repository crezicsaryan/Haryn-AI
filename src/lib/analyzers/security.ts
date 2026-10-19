import type { RawFinding, SourceFile } from "./types";
import { redact, snippet } from "./types";
import { maskNonCode } from "./code-mask";

/* ------------------------------------------------------------------ */
/* Secret detection                                                    */
/* ------------------------------------------------------------------ */

interface SecretRule {
  id: string;
  title: string;
  re: RegExp;
  severity: RawFinding["severity"];
  confidence: number;
  recommendation: string;
  /** Group index that holds the secret (default 0). */
  group?: number;
  /** Skip matches that look like placeholders. */
  allowPlaceholder?: boolean;
}

const PLACEHOLDER_RE =
  /(your[-_ ]?|example|sample|dummy|placeholder|xxxx|changeme|test[-_]?key|<[^>]+>|\$\{|process\.env|import\.meta\.env|os\.environ|getenv|\*\*\*\*)/i;

const SECRET_RULES: SecretRule[] = [
  {
    id: "aws-access-key",
    title: "AWS access key ID detected",
    re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
    severity: "critical",
    confidence: 0.9,
    recommendation:
      "Move the key into environment variables or a secrets manager, and rotate the exposed credential immediately.",
  },
  {
    id: "private-key-block",
    title: "Private key committed to the repository",
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
    severity: "critical",
    confidence: 0.95,
    recommendation:
      "Remove the private key from the repository, purge it from history, and regenerate the key pair.",
  },
  {
    id: "stripe-live-secret",
    title: "Stripe live secret key detected",
    re: /\b(sk_live_[0-9a-zA-Z]{20,})\b/g,
    severity: "critical",
    confidence: 0.92,
    recommendation:
      "Revoke the key in the Stripe dashboard, rotate it, and load it from an environment variable.",
  },
  {
    id: "github-token",
    title: "GitHub token detected",
    re: /\b(gh[pousr]_[0-9A-Za-z]{36,})\b/g,
    severity: "critical",
    confidence: 0.9,
    recommendation:
      "Revoke the token on GitHub, rotate it, and store it as an encrypted secret.",
  },
  {
    id: "google-api-key",
    title: "Google API key detected",
    re: /\b(AIza[0-9A-Za-z\-_]{35})\b/g,
    severity: "high",
    confidence: 0.85,
    recommendation:
      "Restrict the API key by referrer/IP in Google Cloud Console and load it from configuration.",
  },
  {
    id: "slack-token",
    title: "Slack token detected",
    re: /\b(xox[baprs]-[0-9A-Za-z-]{10,})\b/g,
    severity: "high",
    confidence: 0.88,
    recommendation: "Revoke the Slack token and rotate it via environment variables.",
  },
  {
    id: "sendgrid-key",
    title: "SendGrid API key detected",
    re: /\b(SG\.[0-9A-Za-z_-]{22}\.[0-9A-Za-z_-]{43})\b/g,
    severity: "high",
    confidence: 0.9,
    recommendation: "Rotate the SendGrid key and move it out of source control.",
  },
  {
    id: "npm-token",
    title: "npm access token detected",
    re: /\b(npm_[0-9A-Za-z]{36})\b/g,
    severity: "high",
    confidence: 0.85,
    recommendation: "Revoke the npm token and use an encrypted CI secret instead.",
  },
  {
    id: "jwt",
    title: "Hardcoded JWT detected",
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    severity: "medium",
    confidence: 0.6,
    recommendation:
      "Never commit signed tokens. Issue them at runtime and keep signing keys in a secret store.",
    allowPlaceholder: true,
  },
  {
    id: "generic-secret",
    title: "Potential hardcoded credential",
    re: /(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret)\s*[:=]\s*["'`]([^"'`\n]{8,})["'`]/gi,
    severity: "high",
    confidence: 0.55,
    recommendation:
      "Load credentials from environment variables and rotate anything that may have been exposed.",
    group: 1,
    allowPlaceholder: true,
  },
  {
    id: "basic-auth-url",
    title: "Credentials embedded in a URL",
    re: /https?:\/\/[A-Za-z0-9._%-]+:([^@\s/]{6,})@[A-Za-z0-9.-]+/g,
    severity: "high",
    confidence: 0.7,
    recommendation:
      "Remove credentials from URLs and inject them from configuration at runtime.",
    group: 1,
  },
];

/* ------------------------------------------------------------------ */
/* Dangerous-code rules                                                */
/* ------------------------------------------------------------------ */

interface CodeRule {
  id: string;
  title: string;
  re: RegExp;
  severity: RawFinding["severity"];
  confidence: number;
  description: string;
  impact: string;
  recommendation: string;
  /** Restrict to specific languages (optional). */
  languages?: string[];
  /** Marks the finding as a heuristic signal rather than a proven defect. */
  isPotential?: boolean;
  /**
   * Match against code only — string literals and comments are masked out first.
   *
   * Set this on rules that target an executable construct. A `description` or
   * `recommendation` string that quotes the pattern (as every rule in this file
   * does) otherwise matches its own rule, and so does any string literal in the
   * scanned repository. Leave it unset for rules whose subject *is* a literal —
   * SQL text, hash algorithm names, TLS flags and CORS headers all live inside
   * strings, so masking would silence them entirely.
   *
   * `"keep-strings"` masks comments and regex literals but leaves string literals
   * intact. That is the right mode for a rule whose subject lives in a string but
   * which must still not fire on a regex that merely lists the keywords — as the
   * unbounded-query detector does, and which this rule used to report.
   */
  codeOnly?: boolean | "keep-strings";
}

const CODE_RULES: CodeRule[] = [
  {
    id: "eval",
    title: "Use of eval()",
    re: /(^|[^.\w])eval\s*\(/g,
    severity: "high",
    confidence: 0.8,
    description:
      "eval() executes arbitrary strings as code. When the input is not fully controlled it becomes a code-injection vector.",
    impact: "An attacker able to influence the evaluated string can run arbitrary code.",
    recommendation:
      "Replace eval() with an explicit parser or a safe dispatch table. If unavoidable, whitelist the accepted input.",
    codeOnly: true,
  },
  {
    id: "new-function",
    title: "Dynamic Function construction",
    re: /new\s+Function\s*\(/g,
    severity: "high",
    confidence: 0.7,
    description:
      "new Function() compiles a string into executable code, mirroring the risk profile of eval().",
    impact: "Potential code injection if any argument derives from user input.",
    recommendation: "Prefer a static implementation or a sandboxed interpreter.",
    codeOnly: true,
  },
  {
    id: "dangerous-html",
    title: "Unescaped HTML injection into the DOM",
    re: /dangerouslySetInnerHTML|\.innerHTML\s*=|document\.write\s*\(/g,
    severity: "medium",
    confidence: 0.6,
    description:
      "Writing raw HTML without sanitisation can introduce cross-site scripting (XSS).",
    impact: "Reflected or stored XSS if the content includes user-controlled data.",
    recommendation:
      "Sanitise with a library such as DOMPurify, or render text content instead of raw HTML.",
    codeOnly: true,
  },
  {
    id: "child-process",
    title: "Shell command execution",
    /*
     * `exec(` must be a *bare* call, never a method call.
     *
     * `RegExp.prototype.exec` is ordinary code — `re.exec(line)` — and the
     * unanchored `\bexec\s*\(` reported every regex in this codebase as shell
     * execution. The lookbehind keeps the real cases: a destructured
     * `const { exec } = require("child_process")` then `exec(cmd)`, and
     * `child_process.exec(...)` via the first alternative.
     */
    re: /(child_process|execSync|execFileSync|(?<!\.)\bexec\s*\(|spawn\s*\()/g,
    severity: "medium",
    confidence: 0.5,
    description:
      "Spawning shell commands with interpolated values is a command-injection risk when inputs are untrusted.",
    impact: "Command injection leading to host compromise.",
    recommendation:
      "Use execFile/spawn with an argument array and never interpolate user input into a shell string.",
  },
  {
    id: "sql-concat",
    title: "SQL built by string concatenation",
    // The keyword must begin a SQL literal, i.e. sit right after a quote, a
    // backtick, an opening paren, `=` or a comma. Without that anchor the rule
    // also fires on a *regex literal* that merely lists SQL keywords — as in the
    // unbounded-query detector, which is how this rule flagged its own codebase.
    re: /(?:^|(?<=[\s'"`(,=]))(?:SELECT|INSERT|UPDATE|DELETE)[^;'"`\n]*(?:\+\s*\w|`\s*\$\{|\$\{)/gi,
    severity: "high",
    confidence: 0.5,
    description:
      "Query strings assembled from variables can be manipulated to alter query semantics.",
    impact: "SQL injection if the interpolated value is user-controlled.",
    recommendation:
      "Use parameterised queries / prepared statements instead of building SQL by concatenation.",
    codeOnly: "keep-strings",
  },
  {
    id: "cors-wildcard",
    title: "Permissive CORS configuration",
    re: /Access-Control-Allow-Origin["'\s:]*\*|origin\s*:\s*["'`]\*["'`]|allow_origins\s*=\s*\[?\s*["'`]\*["'`]/gi,
    severity: "medium",
    confidence: 0.65,
    description:
      "Allowing every origin lets any website call your API with the user's credentials.",
    impact: "Cross-origin data exposure and CSRF-style abuse.",
    recommendation:
      "Restrict allowed origins to an explicit allow-list of trusted domains.",
  },
  {
    id: "tls-verify-off",
    title: "TLS certificate verification disabled",
    re: /rejectUnauthorized\s*:\s*false|verify\s*=\s*False|InsecureSkipVerify\s*:\s*true|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["'`]?0/g,
    severity: "high",
    confidence: 0.85,
    description:
      "Disabling certificate verification permits man-in-the-middle interception of traffic.",
    impact: "Traffic can be silently intercepted or modified.",
    recommendation:
      "Re-enable verification and, if a private CA is required, trust that CA explicitly.",
  },
  {
    id: "unsafe-deserialise",
    title: "Unsafe deserialisation",
    re: /pickle\.loads\s*\(|yaml\.load\s*\((?![^)]*Safe)|marshal\.loads\s*\(/g,
    severity: "high",
    confidence: 0.75,
    description:
      "Deserialising untrusted data with pickle/marshal/unsafe yaml can execute arbitrary code.",
    impact: "Remote code execution when processing attacker-supplied payloads.",
    recommendation:
      "Use JSON or yaml.safe_load, and never deserialise data from an untrusted source.",
    codeOnly: true,
  },
  {
    id: "weak-hash",
    title: "Weak hash algorithm",
    re: /createHash\s*\(\s*["'`](md5|sha1)["'`]|hashlib\.(md5|sha1)\s*\(/gi,
    severity: "medium",
    confidence: 0.6,
    description:
      "MD5 and SHA-1 are cryptographically broken and unsuitable for integrity or password hashing.",
    impact: "Collisions and fast offline cracking.",
    recommendation:
      "Use SHA-256 for integrity and bcrypt/scrypt/argon2 for passwords.",
  },
  {
    id: "insecure-random",
    title: "Non-cryptographic randomness for a token",
    re: /Math\.random\s*\(\s*\)[^\n]{0,40}(token|secret|key|id|nonce|salt)/gi,
    severity: "medium",
    confidence: 0.45,
    description:
      "Math.random() is predictable and must not be used to generate security-sensitive values.",
    impact: "Predictable tokens enabling session or reset-token forgery.",
    recommendation: "Use crypto.randomUUID() or crypto.getRandomValues().",
    isPotential: true,
    codeOnly: true,
  },
];

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

const ENV_FILES = /(^|\/)\.env(\.|$)/i;

export function analyzeSecurity(files: SourceFile[]): RawFinding[] {
  const findings: RawFinding[] = [];
  const seen = new Set<string>();

  const push = (f: RawFinding, dedupeKey: string) => {
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    findings.push(f);
  };

  // Committed .env files are a strong signal on their own.
  for (const file of files) {
    const base = file.path.split("/").pop() ?? "";
    if (ENV_FILES.test(file.path) && !/\.(example|sample|template|dist)$/i.test(base)) {
      const hasReal = file.lines.some(
        (l) =>
          /^\s*[A-Z0-9_]+\s*=\s*\S+/.test(l) &&
          !/^\s*#/.test(l) &&
          !PLACEHOLDER_RE.test(l)
      );
      if (hasReal) {
        push(
          {
            category: "security",
            severity: "critical",
            title: "Environment file committed to the repository",
            description:
              "A populated .env file is tracked in the repository, which typically means live credentials are stored in version control.",
            filePath: file.path,
            evidence: snippet(base),
            impact:
              "Anyone with repository access can read production credentials, and they persist in git history even after deletion.",
            recommendation:
              "Remove the file from tracking, add it to .gitignore, rotate every value it contained, and ship a .env.example instead.",
            confidence: 0.85,
            source: "static-analysis",
          },
          `env-file:${file.path}`
        );
      }
    }
  }

  for (const file of files) {
    const isEnv = ENV_FILES.test(file.path);

    // Secrets
    for (const rule of SECRET_RULES) {
      let matches = 0;
      for (let i = 0; i < file.lines.length; i++) {
        const line = file.lines[i];
        if (line.length > 2000) continue;
        if (/^\s*(\/\/|#|\*)/.test(line) && rule.id !== "generic-secret") continue;
        rule.re.lastIndex = 0;
        const m = rule.re.exec(line);
        if (!m) continue;
        const value = m[rule.group ?? 0] ?? m[0];
        if (rule.allowPlaceholder !== false && PLACEHOLDER_RE.test(value)) continue;
        if (rule.allowPlaceholder === undefined && PLACEHOLDER_RE.test(line)) continue;

        matches++;
        if (matches > 2) break;
        push(
          {
            category: "security",
            severity: rule.severity,
            title: rule.title,
            description: `${rule.title} at ${file.path}:${i + 1}. The value is masked here and never displayed in full.`,
            filePath: file.path,
            lineStart: i + 1,
            lineEnd: i + 1,
            evidence: `${redact(value)}  ←  ${snippet(line, 120)}`,
            impact:
              "An exposed credential can be used to access the connected service until it is rotated.",
            recommendation: rule.recommendation,
            confidence: rule.confidence,
            source: "static-analysis",
            isPotential: rule.confidence < 0.8,
          },
          `${rule.id}:${file.path}:${i}`
        );
      }
    }

    // Skip dangerous-code rules inside env/config-only files.
    if (isEnv) continue;

    for (const rule of CODE_RULES) {
      if (rule.languages && !rule.languages.includes(file.language)) continue;
      let matches = 0;
      for (let i = 0; i < file.lines.length; i++) {
        const line = file.lines[i];
        if (line.length > 2000) continue;
        if (/^\s*(\/\/|#|\*)/.test(line)) continue;
        // A code-only rule must not match inside a string literal, a comment or a
        // regex literal. Evidence still comes from the original line.
        const haystack =
          rule.codeOnly === "keep-strings"
            ? maskNonCode(line, { strings: false })
            : rule.codeOnly
              ? maskNonCode(line)
              : line;
        rule.re.lastIndex = 0;
        if (!rule.re.test(haystack)) continue;
        matches++;
        if (matches > 2) break;
        push(
          {
            category: "security",
            severity: rule.severity,
            title: rule.title,
            description: rule.description,
            filePath: file.path,
            lineStart: i + 1,
            lineEnd: i + 1,
            evidence: snippet(line),
            impact: rule.impact,
            recommendation: rule.recommendation,
            confidence: rule.confidence,
            source: "static-analysis",
            isPotential: rule.isPotential ?? rule.confidence < 0.7,
          },
          `${rule.id}:${file.path}:${i}`
        );
      }
    }
  }

  return findings;
}
