const YOUTUBE_URL = "https://www.googleapis.com/youtube/v3/videos";
const CATEGORY_LABELS = {
  "1": "cinema e animação",
  "2": "automóveis",
  "10": "música",
  "15": "animais",
  "17": "esportes",
  "20": "jogos",
  "24": "entretenimento",
  "25": "notícias e política",
  "26": "estilo e conhecimento prático",
  "27": "educação",
  "28": "ciência e tecnologia",
};

export async function fetchPopularYouTubeSignals({
  apiKey,
  regionCode,
  maxResults,
  categoryIds = [null],
  fetchImpl = fetch,
}) {
  if (!apiKey) throw new Error("YOUTUBE_API_KEY não configurada");
  if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
    throw new Error("Ao menos uma categoria de sinais é obrigatória");
  }
  const resultsPerCategory = Math.max(1, Math.min(50, Math.ceil(maxResults / categoryIds.length)));
  const batches = await Promise.all(categoryIds.map(async (categoryId) => {
  const url = new URL(YOUTUBE_URL);
    const params = {
    part: "snippet,statistics",
    chart: "mostPopular",
    regionCode,
      maxResults: String(resultsPerCategory),
    key: apiKey,
    };
    if (categoryId) params.videoCategoryId = categoryId;
    url.search = new URLSearchParams(params);

  const response = await fetchImpl(url);
  if (response.status === 404 && categoryId) return [];
  if (!response.ok) {
    throw new Error(`YouTube Data API respondeu ${response.status}`);
  }
  const body = await response.json();
    return body.items ?? [];
  }));

  const unique = new Map();
  for (const item of batches.flat()) unique.set(item.id, item);
  return [...unique.values()].slice(0, maxResults).map((item) => ({
    id: `youtube:${item.id}`,
    platform: "youtube",
    title: item.snippet?.title ?? "Sem título",
    channelId: item.snippet?.channelId ?? "",
    channelTitle: item.snippet?.channelTitle ?? "",
    sourceCategory: CATEGORY_LABELS[item.snippet?.categoryId] ?? "geral",
    publishedAt: item.snippet?.publishedAt ?? null,
    tags: (item.snippet?.tags ?? []).slice(0, 12),
    metrics: {
      views: Number(item.statistics?.viewCount ?? 0),
      likes: Number(item.statistics?.likeCount ?? 0),
      comments: Number(item.statistics?.commentCount ?? 0),
    },
    sourceUrl: `https://www.youtube.com/watch?v=${item.id}`,
    rightsState: "unknown",
  }));
}
