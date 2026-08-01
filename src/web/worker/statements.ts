/**
 * Statement splitting and inspection.
 *
 * Behaviour is the one `electron/src/electron-utils/utilsSQLite.ts` (MIT, this repo) established
 * for the batch `execute` path, but the splitting is done with a character scanner rather than
 * the string-replace-and-split-on-semicolon approach used there: a semicolon inside a string
 * literal, a comment, or a trigger body must not end a statement, and trigger bodies are common
 * in this plugin's upgrade statements.
 *
 * The `sql_deleted` DELETE rewrite that also lives in this layer arrives in M2.
 */

/** Split a batch into individual statements, ignoring semicolons that are not separators. */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let current = '';
  let depth = 0; // nesting of BEGIN ... END inside CREATE TRIGGER bodies

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    // string literal
    if (ch === "'") {
      const end = scanQuoted(sql, i, "'");
      current += sql.slice(i, end);
      i = end - 1;
      continue;
    }
    // quoted identifiers
    if (ch === '"' || ch === '`') {
      const end = scanQuoted(sql, i, ch);
      current += sql.slice(i, end);
      i = end - 1;
      continue;
    }
    if (ch === '[') {
      const end = sql.indexOf(']', i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      current += sql.slice(i, stop);
      i = stop - 1;
      continue;
    }
    // comments
    if (ch === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      const stop = nl === -1 ? sql.length : nl;
      current += sql.slice(i, stop);
      i = stop - 1;
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      current += sql.slice(i, stop);
      i = stop - 1;
      continue;
    }

    if (isWordBoundary(sql, i)) {
      if (matchesKeyword(sql, i, 'BEGIN')) depth++;
      else if (matchesKeyword(sql, i, 'END')) depth = Math.max(0, depth - 1);
    }

    if (ch === ';' && depth === 0) {
      push(out, current);
      current = '';
      continue;
    }
    current += ch;
  }
  push(out, current);
  return out;
}

function push(out: string[], candidate: string): void {
  const trimmed = candidate.trim();
  if (trimmed.length > 0 && stripNoise(trimmed).trim().length > 0) out.push(trimmed);
}

function scanQuoted(sql: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === quote) {
      if (sql[i + 1] === quote) {
        i += 2; // doubled quote is an escaped quote
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return sql.length;
}

function isWordBoundary(sql: string, i: number): boolean {
  return i === 0 || !/[A-Za-z0-9_]/.test(sql[i - 1]);
}

function matchesKeyword(sql: string, i: number, keyword: string): boolean {
  if (sql.substr(i, keyword.length).toUpperCase() !== keyword) return false;
  const after = sql[i + keyword.length];
  return after === undefined || !/[A-Za-z0-9_]/.test(after);
}

/** Remove string literals and comments so keyword matching cannot be fooled by data. */
export function stripNoise(sql: string): string {
  let out = '';
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      i = scanQuoted(sql, i, ch) - 1;
      out += ' ';
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      i = (nl === -1 ? sql.length : nl) - 1;
      out += ' ';
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = (end === -1 ? sql.length : end + 2) - 1;
      out += ' ';
      continue;
    }
    out += ch;
  }
  return out;
}

/** The leading keyword, upper-cased: SELECT, INSERT, UPDATE, DELETE, CREATE, PRAGMA, ... */
export function statementKind(sql: string): string {
  const match = stripNoise(sql)
    .trim()
    .match(/^([A-Za-z]+)/);
  return match ? match[1].toUpperCase() : '';
}

/**
 * True when the statement carries a RETURNING clause. Unlike better-sqlite3, sqlite-wasm can
 * step a RETURNING statement and hand back its rows directly, so the electron workaround of
 * stripping the clause and re-selecting by rowid range is not needed here.
 */
export function hasReturningClause(sql: string): boolean {
  return /\bRETURNING\b/i.test(stripNoise(sql));
}

/** Statements that produce rows, so `exec` knows whether to collect any. */
export function producesRows(sql: string): boolean {
  const kind = statementKind(sql);
  if (kind === 'SELECT' || kind === 'WITH' || kind === 'PRAGMA' || kind === 'EXPLAIN') return true;
  return hasReturningClause(sql);
}

/** Ported from electron-utils: bound `undefined` must reach sqlite as NULL, not throw. */
export function replaceUndefinedByNull(values: any[] | undefined): any[] {
  if (!values || values.length === 0) return [];
  return values.map((value) => (value === undefined ? null : value));
}
