import CryptoAssetView from "@/components/markets/CryptoAssetView";

export default async function CryptoAssetPage({
  params,
  searchParams,
}: {
  params: Promise<{ base: string }>;
  searchParams: Promise<{ instrument?: string | string[]; tab?: string | string[] }>;
}) {
  const [{ base }, { instrument, tab }] = await Promise.all([params, searchParams]);
  const tabParam = Array.isArray(tab) ? tab[0] : tab;
  return (
    <CryptoAssetView
      key={`${base.toUpperCase()}|${tabParam ?? ""}`}
      base={base.toUpperCase()}
      instrumentParam={Array.isArray(instrument) ? instrument[0] : instrument}
      tabParam={tabParam}
    />
  );
}
