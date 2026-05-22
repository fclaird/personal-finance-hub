import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { buildAllocationDigest, formatAllocationDigestEmailHtml, formatAllocationDigestSms } from "@/lib/allocationDigest";
import { signAllocationReportToken } from "@/lib/allocationReportToken";
import { DATA_MODE_COOKIE, parseDataMode, type DataMode } from "@/lib/dataMode";
import { authorizeCronRequest, getReportSigningSecret } from "@/lib/internalCronAuth";

async function sendTwilioSms(to: string, body: string): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_FROM_NUMBER?.trim();
  if (!sid || !token || !from) return { ok: true, skipped: true };
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const params = new URLSearchParams({ To: to.trim(), From: from, Body: body });
  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    return { ok: false, error: `Twilio ${resp.status}: ${t.slice(0, 400)}` };
  }
  return { ok: true };
}

async function sendResendEmail(html: string, subject: string): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.DIGEST_EMAIL_FROM?.trim();
  const to = process.env.DIGEST_EMAIL_TO?.trim();
  if (!key || !from || !to) return { ok: true, skipped: true };
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
    }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    return { ok: false, error: `Resend ${resp.status}: ${t.slice(0, 400)}` };
  }
  return { ok: true };
}

export async function POST(req: Request) {
  if (!authorizeCronRequest(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const jar = await cookies();
  const modeFromCookie = parseDataMode(jar.get(DATA_MODE_COOKIE)?.value);
  let body: { mode?: DataMode; sendSms?: boolean; sendEmail?: boolean } = {};
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      body = (await req.json()) as typeof body;
    }
  } catch {
    /* ignore */
  }
  const mode: DataMode = body.mode === "schwab" || body.mode === "auto" ? body.mode : modeFromCookie;
  const sendSms = body.sendSms !== false;
  const sendEmail = body.sendEmail !== false;

  const payload = buildAllocationDigest(mode);
  const baseUrl = process.env.PUBLIC_APP_URL?.replace(/\/+$/, "") ?? "";
  let reportUrl: string | undefined;
  if (baseUrl) {
    const secret = getReportSigningSecret();
    if (secret) {
      const token = await signAllocationReportToken(secret, 86400, mode);
      reportUrl = `${baseUrl}/allocation/report?token=${encodeURIComponent(token)}`;
    }
  }

  const smsBody = formatAllocationDigestSms(payload, { reportUrl });
  const subject = `Allocation digest ${payload.generatedAt.slice(0, 10)}`;

  const results: Record<string, unknown> = { ok: true, generatedAt: payload.generatedAt, mode };

  if (sendSms) {
    const to = process.env.DIGEST_SMS_TO?.trim();
    if (!to) {
      results.sms = { skipped: true, reason: "DIGEST_SMS_TO not set" };
    } else {
      results.sms = await sendTwilioSms(to, smsBody);
    }
  } else {
    results.sms = { skipped: true, reason: "sendSms false" };
  }

  if (sendEmail) {
    const html = formatAllocationDigestEmailHtml(payload);
    results.email = await sendResendEmail(html, subject);
  } else {
    results.email = { skipped: true, reason: "sendEmail false" };
  }

  return NextResponse.json(results);
}
