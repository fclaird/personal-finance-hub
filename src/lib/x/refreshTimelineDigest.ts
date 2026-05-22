import { getSecretsPassphrase } from "@/lib/env";
import { fetchUserTimeline24h, fetchXUserId, getValidXAccessToken } from "@/lib/x/client";
import { buildDigestFromTweets } from "@/lib/x/digest";
import { writeDigestCache } from "@/lib/x/cacheDb";
import { getXToken, setXToken } from "@/lib/x/token";
import type { XDigestPayload } from "@/lib/x/types";

export type RefreshTimelineDigestResult =
  | { ok: true; payload: XDigestPayload; tweetCount: number }
  | { ok: false; error: string };

export async function refreshTimelineDigest(): Promise<RefreshTimelineDigestResult> {
  try {
    const passphrase = getSecretsPassphrase();
    const valid = await getValidXAccessToken(passphrase);
    if (!valid) {
      return { ok: false, error: "X not connected or token expired. Connect under Connections." };
    }

    let userId = valid.token.user_id;
    if (!userId) {
      userId = (await fetchXUserId(valid.accessToken)) ?? undefined;
      if (userId) {
        const cur = getXToken(passphrase);
        if (cur) setXToken(passphrase, { ...cur, user_id: userId });
      }
    }
    if (!userId) {
      return { ok: false, error: "Could not resolve X user id." };
    }

    const tweets = await fetchUserTimeline24h(valid.accessToken, userId);
    const payload = await buildDigestFromTweets(tweets);
    writeDigestCache(payload);
    return { ok: true, payload, tweetCount: tweets.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
