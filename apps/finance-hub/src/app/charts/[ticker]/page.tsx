import { ChartWorkspace } from "@/app/components/tvchart/ChartWorkspace";

type PageProps = { params: Promise<{ ticker: string }> };

export default async function ChartTickerPage({ params }: PageProps) {
  const { ticker } = await params;
  return <ChartWorkspace ticker={decodeURIComponent(ticker)} />;
}
