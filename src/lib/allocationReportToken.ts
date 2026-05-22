import { SignJWT, jwtVerify } from "jose";

import type { DataMode } from "@/lib/dataMode";

const ISS = "finance-hub:allocation-report";

export async function signAllocationReportToken(
  secret: string,
  ttlSec: number = 900,
  dataMode: DataMode = "auto",
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ purpose: "allocation-report", dataMode })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISS)
    .setIssuedAt()
    .setExpirationTime(`${ttlSec}s`)
    .sign(key);
}

export async function verifyAllocationReportToken(
  token: string,
  secret: string,
): Promise<{ ok: true; dataMode: DataMode } | { ok: false }> {
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key, { issuer: ISS });
    if (payload.purpose !== "allocation-report") return { ok: false };
    const dm = payload.dataMode;
    const dataMode: DataMode = dm === "schwab" || dm === "auto" ? dm : "auto";
    return { ok: true, dataMode };
  } catch {
    return { ok: false };
  }
}
