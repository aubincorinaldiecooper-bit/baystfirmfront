"use client";

import { Badge } from "@/components/finance/ui";
import { formatClock } from "@/lib/markets/labels";
import {
  FACT_TITLES,
  factSummary,
  formatAge,
  formatUsd,
  glance,
  shortAddress,
  sourceLabel,
  timeOf,
  type FactKey,
} from "@/lib/markets/tokens";
import type { TokenCard } from "@/lib/markets/types";

const FACT_ORDER: FactKey[] = [
  "mint_authority",
  "freeze_authority",
  "liquidity_lock",
  "top10_share",
  "token_extensions",
  "metadata_mutable",
  "market",
];

export function Glances({ card }: { card: TokenCard }) {
  return (
    <div className="flex flex-wrap gap-1">
      {glance(card).map((item) => (
        <Badge key={item.key} tone={item.tone} dot>
          {item.label}
        </Badge>
      ))}
    </div>
  );
}

function readAt(iso: string | null) {
  return iso ? `${iso.slice(0, 10)} ${formatClock(iso)}` : "time unknown";
}

export default function TokenFactsList({ card }: { card: TokenCard }) {
  const holders = card.facts.top10_share.status === "ok" ? (card.facts.top10_share.value?.holders ?? []) : [];
  const top10 = card.facts.top10_share.status === "ok" ? card.facts.top10_share.value : null;
  const market = card.facts.market.status === "ok" ? card.facts.market.value : null;
  const second = card.second_opinion;

  return (
    <>
      <div className="mt-4">
        <Glances card={card} />
      </div>

      <h3 className="mt-5 text-[13px] font-semibold text-ink">Our checks</h3>
      <dl className="mt-2 divide-y divide-line rounded-[10px] bg-canvas">
        {FACT_ORDER.map((key) => {
          const fact = card.facts[key];
          return (
            <div key={key} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[150px_1fr]">
              <dt className="text-[12.5px] font-medium text-ink">{FACT_TITLES[key]}</dt>
              <dd className="text-[12.5px] text-ink-2">
                <div>{factSummary(key, card)}</div>
                {key === "top10_share" && top10 && (
                  <div className="mt-1 space-y-0.5 text-[11.5px] text-ink-3">
                    {card.facts.top10_share.source === "geckoterminal" && (
                      <p>Per GeckoTerminal; may include pool and exchange accounts.</p>
                    )}
                    {top10.holder_count !== null && (
                      <p>Holder count: {top10.holder_count.toLocaleString("en-US")}</p>
                    )}
                    {top10.as_of && (
                      <p>Holder data as of <time dateTime={top10.as_of}>{readAt(top10.as_of)}</time></p>
                    )}
                  </div>
                )}
                <div className="mt-0.5 text-[11.5px] text-ink-3">
                  {sourceLabel(fact.source)} · {fact.fetched_at ? `read ${readAt(fact.fetched_at)}` : "not read"}
                  {fact.status === "ok" &&
                  fact.detail &&
                  !(key === "top10_share" && fact.source === "geckoterminal")
                    ? ` · ${fact.detail}`
                    : ""}
                </div>
              </dd>
            </div>
          );
        })}
      </dl>

      {market && (
        <div className="mt-3 rounded-[10px] bg-canvas px-3 py-2.5 text-[12px] text-ink-2">
          <p>
            {market.pool_count} pools · total liquidity {formatUsd(market.total_liquidity_usd)} · total 24h volume{" "}
            {formatUsd(market.total_volume_24h_usd)}
          </p>
          <p className="mt-0.5 text-[11.5px] text-ink-3">
            Main pool {market.main_pool ? `${market.main_pool.dex} ${shortAddress(market.main_pool.address)}` : "unknown"}
            {market.pool_created_at !== null
              ? ` · opened ${formatAge(market.pool_created_at, timeOf(card.checked_at) ?? Date.now())} before this check`
              : ""}
            {market.price_change_24h_pct !== null ? ` · 24h change ${market.price_change_24h_pct.toFixed(1)}%` : ""}
            {market.pools_checked_at ? ` · pools checked ${readAt(market.pools_checked_at)}` : ""}
          </p>
        </div>
      )}

      {holders.length > 0 && (
        <>
          <h3 className="mt-5 text-[13px] font-semibold text-ink">Largest holders</h3>
          <div className="mt-2 overflow-x-auto rounded-[10px] bg-canvas">
            <table className="w-full text-left text-[12px]">
              <thead className="text-[11px] uppercase tracking-[0.04em] text-ink-3">
                <tr className="border-b border-line">
                  <th className="px-3 py-1.5 font-medium">Wallet</th>
                  <th className="px-3 py-1.5 text-right font-medium">Share of supply</th>
                  <th className="px-3 py-1.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {holders.map((holder) => (
                  <tr key={holder.owner} className="border-b border-line last:border-0">
                    <td className="px-3 py-1.5 font-mono text-ink-2"><bdi>{shortAddress(holder.owner)}</bdi></td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink">{holder.pct.toFixed(2)}%</td>
                    <td className="px-3 py-1.5">
                      {holder.is_pool && (
                        <Badge>
                          {top10?.pool_accounts_excluded ? "Pool, not counted" : "Pool account"}
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h3 className="mt-5 text-[13px] font-semibold text-ink">Second opinion: {second.provider}</h3>
      <div className="mt-2 rounded-[10px] bg-canvas px-3 py-2.5 text-[12.5px] text-ink-2">
        <p className="text-[11.5px] text-ink-3">
          {second.provider}&apos;s own assessment, not ours. {second.fetched_at ? `Read ${readAt(second.fetched_at)}.` : ""}
        </p>
        {second.status === "ok" ? (
          <>
            <p className="mt-1">
              {second.score_normalised !== null ? `Risk score ${second.score_normalised} (their scale)` : "No risk score"}
              {second.lp_locked_pct !== null ? ` · liquidity locked ${second.lp_locked_pct.toFixed(1)}%` : ""}
            </p>
            {second.risks.length > 0 ? (
              <ul className="mt-1 list-disc pl-5">
                {second.risks.map((risk) => (
                  <li key={risk.name}>
                    <bdi>{risk.name}</bdi> ({risk.level}){risk.description ? `: ${risk.description}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1">No risks flagged.</p>
            )}
          </>
        ) : (
          <p className="mt-1">No report available from {second.provider} right now.</p>
        )}
      </div>
    </>
  );
}
