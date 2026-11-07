"use client";

import { PAGE_FRAME } from "@/app/components/pageFrame";
import Link from "next/link";

import { EditablePageHeading } from "@/app/components/EditableHeading";
import { FortressLab } from "@/app/diversification/FortressLab";
import { HeldWeights } from "@/app/diversification/HeldWeights";

export default function DiversificationPage() {
  return (
    <div className={PAGE_FRAME}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
            <EditablePageHeading pageId="diversification" defaultTitle="Diversification" />
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300">
            A read-only before/after ledger. Diversification is one input. The simulator does not place orders, write accounts, or call a book safe.
          </p>
        </div>
        <Link
          href="/connections"
          className="rounded-full border border-zinc-400 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50"
        >
          Connections
        </Link>
      </div>
      <FortressLab />
      <details className="rounded-xl border border-zinc-400 bg-zinc-950 p-4 text-zinc-100">
        <summary className="cursor-pointer text-sm font-semibold">Held weights from the existing exposure rollup</summary>
        <div className="mt-4">
          <HeldWeights />
        </div>
      </details>
    </div>
  );
}
