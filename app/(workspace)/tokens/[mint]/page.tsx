import TokenAssetView from "@/components/markets/TokenAssetView";

export default async function TokenAssetPage({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  return <TokenAssetView mint={mint} />;
}
