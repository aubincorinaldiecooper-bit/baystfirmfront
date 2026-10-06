"use client";

import { useEffect, useState } from "react";
import { Section } from "@/components/finance/ui";
import { getFilings, getNews } from "@/lib/markets/client";
import type { NewsItem, NewsKind } from "@/lib/markets/types";
import NewsList, { NEWS_NOTE } from "./NewsList";

export default function NewsSection({
  title,
  feed,
  symbol,
  kinds,
  tickers,
  limit = 50,
  emptyMessage = "No events yet",
  description,
  currentAsset,
}: {
  title: string;
  feed: "news" | "filings";
  symbol?: string;
  kinds?: readonly NewsKind[];
  tickers?: readonly string[];
  limit?: number;
  emptyMessage?: string;
  description?: string;
  currentAsset?: { kind: "crypto" | "token"; symbol: string };
}) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState(NEWS_NOTE);
  const [empty, setEmpty] = useState(emptyMessage);
  const kindsKey = (kinds ?? []).join(",");
  const tickersKey = (tickers ?? []).join(",");
  const sectionId = `news-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

  useEffect(() => {
    const controller = new AbortController();
    setItems([]);
    setLoading(true);
    setError(null);
    setEmpty(emptyMessage);
    const request =
      feed === "filings"
        ? getFilings(tickersKey ? tickersKey.split(",") : [], limit, fetch, controller.signal)
        : getNews(
            {
              ...(symbol ? { symbol } : {}),
              ...(kindsKey ? { kinds: kindsKey.split(",") as NewsKind[] } : {}),
              limit,
            },
            fetch,
            controller.signal,
          );
    request
      .then((response) => {
        if (controller.signal.aborted) return;
        setItems(response.items);
        setNote(response.note);
        if ("notes" in response && response.items.length === 0 && response.notes.length > 0) {
          setEmpty(response.notes.join(" "));
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || (cause instanceof Error && cause.name === "AbortError")) return;
        setError(cause instanceof Error ? cause.message : "Unknown request error.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [emptyMessage, feed, kindsKey, limit, symbol, tickersKey]);

  return (
    <Section id={sectionId} title={title} count={items.length}>
      {description && <p className="mb-2 text-[11.5px] leading-[1.5] text-ink-3">{description}</p>}
      <NewsList items={items} loading={loading} error={error} emptyMessage={empty} note={note} currentAsset={currentAsset} />
    </Section>
  );
}
