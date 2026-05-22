import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { authorizeCronRequest } from "@/lib/internalCronAuth";
import { insertNewsItems, type IngestInput } from "@/lib/news/store";

type BodySingle = {
  text?: string;
  link?: string | null;
  publishedAt?: string | null;
  source?: string;
};

type BodyBatch = {
  items?: BodySingle[];
};

function normalizeInputs(body: BodySingle | BodyBatch): IngestInput[] {
  if (Array.isArray((body as BodyBatch).items)) {
    return (body as BodyBatch).items!
      .filter((x) => typeof x?.text === "string" && x.text.trim().length > 0)
      .map((x) => ({
        text: x.text!.trim(),
        link: x.link ?? null,
        publishedAt: x.publishedAt ?? null,
        source: x.source,
      }));
  }
  const single = body as BodySingle;
  if (typeof single.text !== "string" || !single.text.trim()) return [];
  return [
    {
      text: single.text.trim(),
      link: single.link ?? null,
      publishedAt: single.publishedAt ?? null,
      source: single.source,
    },
  ];
}

export async function POST(req: Request) {
  if (!authorizeCronRequest(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: BodySingle | BodyBatch;
  try {
    body = (await req.json()) as BodySingle | BodyBatch;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const inputs = normalizeInputs(body);
  if (inputs.length === 0) {
    return NextResponse.json({ ok: false, error: "Missing text or items[].text" }, { status: 400 });
  }

  const db = getDb();
  const { inserted, skipped } = insertNewsItems(db, inputs);
  return NextResponse.json({ ok: true, inserted, skipped, received: inputs.length });
}
