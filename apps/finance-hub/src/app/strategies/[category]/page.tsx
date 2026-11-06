import { Suspense } from "react";
import { PAGE_FRAME } from "@/app/components/pageFrame";
import { notFound } from "next/navigation";

import { StrategyCategoryPage } from "@/app/components/strategy/StrategyCategoryPage";
import { isStrategyTabSlug } from "@/lib/strategy/strategyCategories";

type PageProps = {
  params: Promise<{ category: string }>;
};

/** Avoids long async default export name in dev (Turbopack + Performance.measure can throw on some RSC paths). */
function StrategyCategorySkeleton() {
  return <div className="py-8 text-sm text-zinc-500 dark:text-zinc-400">Loading strategies…</div>;
}

async function StrategyCategoryBody({ params }: PageProps) {
  const { category } = await params;
  if (!isStrategyTabSlug(category)) notFound();
  return <StrategyCategoryPage category={category} />;
}

export default function Page(props: PageProps) {
  return (
    <div className={PAGE_FRAME}>
      <Suspense fallback={<StrategyCategorySkeleton />}>
        <StrategyCategoryBody {...props} />
      </Suspense>
    </div>
  );
}
