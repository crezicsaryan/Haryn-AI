/**
 * Masks the non-code parts of a source line so a rule can match *code* only.
 *
 * Why this exists: a rule that looks for an executable construct (`eval(`,
 * `.map(async`, `i <= x.length`, a decision point) has no business matching
 * inside a string literal, a comment or a regex literal. Without this, a scanner
 * ends up reporting its own rule table — every `description` and `recommendation`
 * string that quotes an example of the pattern it detects looks like a real
 * occurrence of that pattern. That is exactly the "cries wolf" failure mode the
 * bug analyzer is written to avoid: a finding on a string literal is never
 * actionable, and it buries the real ones.
 *
 * The complexity estimator is the clearest case. It counts `&&`, `||` and `|` as
 * decision points, so a function whose body contains one alternation-heavy regex
 * was scored as far more complex than it is — a six-line function was reported
 * with an estimated complexity of 20.
 *
 * The returned string has the same length as the input, with the characters
 * inside the masked regions replaced by spaces, so match offsets and column
 * arithmetic stay valid. Callers keep using the original line for evidence.
 *
 * Scope: `//` and `/* *\/` comments, `'`, `"` and `` ` `` literals (template
 * interpolations are kept as code, because they are evaluated), and regex
 * literals.
 *
 * Deliberately opt-in per rule — secret detection must keep matching *inside*
 * strings, since a hard-coded credential is a string literal by nature, and SQL
 * text lives in template literals. Pass `{ strings: false }` for those.
 */
export interface MaskOptions {
  /**
   * Also mask string and template literals (default `true`). Set `false` when the
   * rule's subject genuinely lives inside a string — SQL, header values, hashes.
   */
  strings?: boolean;
}

export function maskNonCode(line: string, options: MaskOptions = {}): string {
  const maskStrings = options.strings !== false;
  const n = line.length;
  const out = line.split("");
  /** Open template-literal / interpolation contexts, innermost last. */
  const stack: { kind: "tpl" | "interp"; depth: number }[] = [];

  const blank = (from: number, to: number) => {
    for (let k = Math.max(0, from); k < to && k < n; k++) out[k] = " ";
  };

  let i = 0;
  while (i < n) {
    const ch = line[i];
    const inTemplate =
      stack.length > 0 && stack[stack.length - 1].kind === "tpl";

    if (inTemplate) {
      if (ch === "\\") {
        blank(i, i + 2);
        i += 2;
        continue;
      }
      if (ch === "`") {
        blank(i, i + 1);
        stack.pop();
        i++;
        continue;
      }
      if (ch === "$" && line[i + 1] === "{") {
        blank(i, i + 2);
        stack.push({ kind: "interp", depth: 0 });
        i += 2;
        continue;
      }
      blank(i, i + 1);
      i++;
      continue;
    }

    /* ---- code context (top level, or inside a ${ … } interpolation) ---- */

    if (ch === "/" && line[i + 1] === "/") {
      blank(i, n);
      break;
    }
    if (ch === "/" && line[i + 1] === "*") {
      const end = line.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (maskStrings && (ch === '"' || ch === "'")) {
      const end = scanQuoted(line, i, ch);
      blank(i, end);
      i = end;
      continue;
    }
    if (maskStrings && ch === "`") {
      blank(i, i + 1);
      stack.push({ kind: "tpl", depth: 0 });
      i++;
      continue;
    }
    if (ch === "/" && startsRegex(line, i)) {
      const end = scanRegex(line, i);
      blank(i, end);
      i = end;
      continue;
    }

    const top = stack[stack.length - 1];
    if (top?.kind === "interp") {
      if (ch === "{") {
        top.depth++;
      } else if (ch === "}") {
        if (top.depth === 0) {
          blank(i, i + 1);
          stack.pop();
          i++;
          continue;
        }
        top.depth--;
      }
    }
    i++;
  }

  return out.join("");
}

/** Index just past the closing quote, honouring backslash escapes. */
function scanQuoted(line: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i++;
  }
  return line.length;
}

/**
 * Is the `/` at `index` the start of a regex literal rather than a division?
 *
 * A regex can only follow an operator, an opening bracket, a comma, a colon or
 * the start of a statement. After an identifier, a number or a closing bracket
 * the `/` is division — `a / b` must not be treated as the start of a pattern,
 * or the rest of the line would be masked and real code would go unchecked.
 */
function startsRegex(line: string, index: number): boolean {
  for (let k = index - 1; k >= 0; k--) {
    const ch = line[k];
    if (ch === " " || ch === "\t") continue;
    return "([{,;:=!&|?+-*%<>~^".includes(ch);
  }
  return true; // start of line
}

/** Index just past the closing `/`, ignoring `\/` and slashes inside `[...]`. */
function scanRegex(line: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) return i + 1;
    i++;
  }
  return line.length;
}
