import { redirect } from "next/navigation";

import { DEFAULT_STRATEGY_HREF } from "@/lib/strategy/strategyTabGroups";

export default function StrategiesIndexPage() {
  redirect(DEFAULT_STRATEGY_HREF);
}
