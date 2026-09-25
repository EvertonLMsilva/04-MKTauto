const YOUTUBE_URL = "https://www.googleapis.com/youtube/v3/videos";

export async function fetchPopularYouTubeSignals({ apiKey, regionCode, maxResults, fetchImpl = fetch }) {
  if (!apiKey) throw new Error("YOUTUBE_API_KEY não configurada");
  const url = new URL(YOUTUBE_URL);
  url.search = new URLSearchParams({
    part: "snippet,statistics",
    chart: "mostPopular",
    regionCode,
    maxResults: String(maxResults),
    key: apiKey,
  });

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`YouTube Data API respondeu ${response.status}`);
  }
  const body = await response.json();
  return (body.items ?? []).map((item) => ({
    id: `youtube:${item.id}`,
    platform: "youtube",
    title: item.snippet?.title ?? "Sem título",
    channelId: item.snippet?.channelId ?? "",
    channelTitle: item.snippet?.channelTitle ?? "",
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
