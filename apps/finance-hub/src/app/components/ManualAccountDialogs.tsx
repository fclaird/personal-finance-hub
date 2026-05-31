"use client";

import { useEffect, useState } from "react";

import type { AccountBucket } from "@/lib/accountBuckets";
import { accountBucketLabel } from "@/lib/accountBuckets";

const BUCKETS: AccountBucket[] = ["brokerage", "retirement", "529"];

function bucketPillClass(active: boolean) {
  return (
    "rounded-full px-4 py-2 text-sm font-medium " +
    (active
      ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
      : "border border-zinc-300 bg-white text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
  );
}

export function BucketPicker({
  value,
  onChange,
}: {
  value: AccountBucket;
  onChange: (b: AccountBucket) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {BUCKETS.map((b) => (
        <button key={b} type="button" onClick={() => onChange(b)} className={bucketPillClass(value === b)}>
          {accountBucketLabel(b)}
        </button>
      ))}
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-300 bg-white p-5 shadow-xl dark:border-white/20 dark:bg-zinc-950">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-white/10"
          >
            Close
          </button>
        </div>
        <div className="mt-4 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium text-zinc-800 dark:text-zinc-200">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100";

export function AddManualAccountDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (account: { id: string; name: string; accountBucket: AccountBucket }) => void;
}) {
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [accountBucket, setAccountBucket] = useState<AccountBucket>("brokerage");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setNickname("");
    setAccountBucket("brokerage");
    setError(null);
  }, [open]);

  if (!open) return null;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const resp = await fetch("/api/manual/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, nickname: nickname || null, accountBucket }),
      });
      const json = (await resp.json()) as {
        ok: boolean;
        error?: string;
        account?: { id: string; name: string; accountBucket: AccountBucket };
      };
      if (!json.ok || !json.account) throw new Error(json.error ?? "Failed to create account");
      onSaved(json.account);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title="Add external account" onClose={onClose}>
      <Field label="Account name">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fidelity 529" />
      </Field>
      <Field label="Nickname (optional)">
        <input className={inputClass} value={nickname} onChange={(e) => setNickname(e.target.value)} />
      </Field>
      <div>
        <div className="mb-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">Account type</div>
        <BucketPicker value={accountBucket} onChange={setAccountBucket} />
      </div>
      {error ? <div className="text-sm text-red-600 dark:text-red-400">{error}</div> : null}
      <button
        type="button"
        disabled={saving || !name.trim()}
        onClick={() => void save()}
        className="rounded-full bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {saving ? "Saving…" : "Create account"}
      </button>
    </ModalShell>
  );
}

export function EditManualAccountDialog({
  open,
  account,
  onClose,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  account: { id: string; name: string; nickname: string | null; accountBucket: AccountBucket } | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [accountBucket, setAccountBucket] = useState<AccountBucket>("brokerage");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !account) return;
    setName(account.name);
    setNickname(account.nickname ?? "");
    setAccountBucket(account.accountBucket);
    setError(null);
  }, [open, account]);

  if (!open || !account) return null;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const resp = await fetch(`/api/manual/accounts/${encodeURIComponent(account!.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, nickname: nickname || null, accountBucket }),
      });
      const json = (await resp.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Failed to update account");
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const label = name.trim() || account!.name;
    if (
      !confirm(
        `Remove external account "${label}"? All holdings entered for this account will be permanently deleted.`,
      )
    ) {
      return;
    }
    setRemoving(true);
    setError(null);
    try {
      const resp = await fetch(`/api/manual/accounts/${encodeURIComponent(account!.id)}`, { method: "DELETE" });
      const json = (await resp.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Failed to remove account");
      onDeleted();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <ModalShell title="Edit external account" onClose={onClose}>
      <Field label="Account name">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Nickname (optional)">
        <input className={inputClass} value={nickname} onChange={(e) => setNickname(e.target.value)} />
      </Field>
      <div>
        <div className="mb-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">Account type</div>
        <BucketPicker value={accountBucket} onChange={setAccountBucket} />
      </div>
      {error ? <div className="text-sm text-red-600 dark:text-red-400">{error}</div> : null}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={saving || removing || !name.trim()}
          onClick={() => void save()}
          className="rounded-full bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          disabled={saving || removing}
          onClick={() => void remove()}
          className="rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/30"
        >
          {removing ? "Removing…" : "Remove account"}
        </button>
      </div>
    </ModalShell>
  );
}

export type ManualPositionFormState = {
  positionId?: string;
  accountId: string;
  symbol: string;
  securityType: "equity" | "fund" | "cash";
  quantity: string;
  purchasePrice: string;
  marketValue: string;
  purchaseDate: string;
  notes: string;
};

export function ManualPositionDialog({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: ManualPositionFormState | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ManualPositionFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && initial) setForm({ ...initial });
  }, [open, initial]);

  if (!open || !form) return null;

  const positionForm = form;

  function setField<K extends keyof ManualPositionFormState>(key: K, value: ManualPositionFormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function anchorFundStatement() {
    setSaving(true);
    setError(null);
    try {
      const resp = await fetch(`/api/manual/accounts/${encodeURIComponent(positionForm.accountId)}/positions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positionId: positionForm.positionId,
          symbol: positionForm.symbol,
          securityType: "fund",
          quantity: Number(positionForm.quantity),
          purchasePrice: positionForm.purchasePrice.trim() === "" ? null : Number(positionForm.purchasePrice),
          marketValue: positionForm.marketValue.trim() === "" ? null : Number(positionForm.marketValue),
          purchaseDate: positionForm.purchaseDate.trim() || null,
          notes: positionForm.notes.trim() || null,
          anchorStatement: true,
        }),
      });
      const json = (await resp.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Failed to anchor statement balance");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function refreshMv() {
    if (positionForm.securityType === "fund") {
      await anchorFundStatement();
      return;
    }
    const sym = positionForm.securityType === "cash" ? null : positionForm.symbol.trim().toUpperCase();
    if (!sym) return;
    const resp = await fetch("/api/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: [sym] }),
    });
    const json = (await resp.json()) as {
      ok: boolean;
      quotes?: Array<{ symbol: string; last: number | null; mark?: number | null; close: number | null }>;
    };
    if (!json.ok) return;
    const q = json.quotes?.[0];
    const px = q?.last ?? q?.mark ?? q?.close;
    const qty = Number(positionForm.quantity);
    if (px != null && Number.isFinite(px) && Number.isFinite(qty)) {
      setField("marketValue", String(px * qty));
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const resp = await fetch(`/api/manual/accounts/${encodeURIComponent(positionForm.accountId)}/positions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positionId: positionForm.positionId,
          symbol: positionForm.securityType === "cash" ? "CASH" : positionForm.symbol,
          securityType: positionForm.securityType,
          quantity: Number(positionForm.quantity),
          purchasePrice: positionForm.purchasePrice.trim() === "" ? null : Number(positionForm.purchasePrice),
          marketValue: positionForm.marketValue.trim() === "" ? null : Number(positionForm.marketValue),
          purchaseDate: positionForm.purchaseDate.trim() || null,
          notes: positionForm.notes.trim() || null,
        }),
      });
      const json = (await resp.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Failed to save holding");
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title={positionForm.positionId ? "Edit holding" : "Add holding"} onClose={onClose}>
      <Field label="Type">
        <select
          className={inputClass}
          value={positionForm.securityType}
          onChange={(e) => setField("securityType", e.target.value as ManualPositionFormState["securityType"])}
        >
          <option value="equity">Stock / ETF</option>
          <option value="fund">Fund</option>
          <option value="cash">Cash</option>
        </select>
      </Field>
      {positionForm.securityType !== "cash" ? (
        <Field label="Symbol">
          <input className={inputClass} value={positionForm.symbol} onChange={(e) => setField("symbol", e.target.value.toUpperCase())} />
        </Field>
      ) : null}
      <Field label={positionForm.securityType === "cash" ? "Cash balance ($)" : "Quantity"}>
        <input className={inputClass} value={positionForm.quantity} onChange={(e) => setField("quantity", e.target.value)} inputMode="decimal" />
      </Field>
      {positionForm.securityType !== "cash" ? (
        <>
          <Field label="Purchase date">
            <input className={inputClass} type="date" value={positionForm.purchaseDate} onChange={(e) => setField("purchaseDate", e.target.value)} />
          </Field>
          <Field label="Purchase price (per share)">
            <input
              className={inputClass}
              value={positionForm.purchasePrice}
              onChange={(e) => setField("purchasePrice", e.target.value)}
              inputMode="decimal"
            />
          </Field>
          <Field
            label={
              positionForm.securityType === "fund"
                ? "Market value (from 529 statement)"
                : "Market value"
            }
          >
            <div className="flex flex-col gap-1">
              <div className="flex gap-2">
                <input
                  className={inputClass}
                  value={positionForm.marketValue}
                  onChange={(e) => setField("marketValue", e.target.value)}
                  inputMode="decimal"
                />
                <button
                  type="button"
                  onClick={() => void refreshMv()}
                  className="shrink-0 rounded-md border border-zinc-300 px-3 text-xs font-medium dark:border-white/20"
                >
                  {positionForm.securityType === "fund" ? "Anchor" : "Refresh"}
                </button>
              </div>
              {positionForm.securityType === "fund" ? (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Enter the balance from your 529 statement once, then Save. We update it with the fund&apos;s market
                  return (not public NAV × shares).
                </p>
              ) : null}
            </div>
          </Field>
        </>
      ) : null}
      <Field label="Notes (optional)">
        <input className={inputClass} value={positionForm.notes} onChange={(e) => setField("notes", e.target.value)} />
      </Field>
      {error ? <div className="text-sm text-red-600 dark:text-red-400">{error}</div> : null}
      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="rounded-full bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {saving ? "Saving…" : "Save holding"}
      </button>
    </ModalShell>
  );
}
