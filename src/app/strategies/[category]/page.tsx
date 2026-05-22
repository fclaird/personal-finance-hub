import { Suspense } from "react";
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
    <div className="flex w-full max-w-[108rem] flex-1 flex-col gap-8 py-10 pl-5 pr-6 sm:pl-6 sm:pr-8">
      <Suspense fallback={<StrategyCategorySkeleton />}>
        <StrategyCategoryBody {...props} />
      </Suspense>
    </div>
  );
}
