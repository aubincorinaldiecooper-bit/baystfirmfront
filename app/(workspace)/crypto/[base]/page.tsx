import CryptoAssetView from "@/components/markets/CryptoAssetView";

export default async function CryptoAssetPage({
  params,
  searchParams,
}: {
  params: Promise<{ base: string }>;
  searchParams: Promise<{ instrument?: string | string[] }>;
}) {
  const [{ base }, { instrument }] = await Promise.all([params, searchParams]);
  return (
    <CryptoAssetView
      base={base.toUpperCase()}
      instrumentParam={Array.isArray(instrument) ? instrument[0] : instrument}
    />
  );
}
