import { createHash } from "node:crypto";

import type { ParsedIngestPost } from "./types";

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

export function normalizeIngestBody(text: string): string {
  return (text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim();
}

export function contentHashFromBody(body: string): string {
  const norm = normalizeIngestBody(body).toLowerCase().replace(/\s+/g, " ");
  return createHash("sha256").update(norm).digest("hex").slice(0, 32);
}

export function extractFirstUrl(text: string): string | null {
  const m = text.match(URL_RE);
  if (!m?.length) return null;
  return m[0]!.replace(/[.,;:!?)]+$/, "");
}

export function titleFromBody(body: string): string {
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const first = lines[0] ?? body;
  const oneLine = first.replace(/\s+/g, " ").trim();
  if (oneLine.length <= 200) return oneLine;
  return `${oneLine.slice(0, 197)}…`;
}

export function syntheticIngestLink(source: string, contentHash: string): string {
  return `app://news/${source}/${contentHash}`;
}

export function parseIngestText(
  text: string,
  opts?: { link?: string | null; source?: string },
): ParsedIngestPost | null {
  const body = normalizeIngestBody(text);
  if (!body) return null;
  const contentHash = contentHashFromBody(body);
  const source = (opts?.source ?? "caktusjxck").trim().toLowerCase() || "caktusjxck";
  const explicit = opts?.link?.trim();
  const link =
    explicit && explicit.length > 0
      ? explicit
      : extractFirstUrl(body) ?? syntheticIngestLink(source, contentHash);
  return {
    title: titleFromBody(body),
    body,
    link,
    contentHash,
  };
}

const DOLLAR_TICKER_RE = /\$([A-Z]{1,5})\b/g;

/** Tickers explicitly marked with $SYMBOL in text. */
export function extractDollarTickers(text: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(DOLLAR_TICKER_RE.source, "gi");
  while ((m = re.exec(text)) !== null) {
    const s = (m[1] ?? "").toUpperCase();
    if (s.length >= 1 && s.length <= 5) out.add(s);
  }
  return [...out];
}
