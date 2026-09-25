const API_URL = "https://commons.wikimedia.org/w/api.php";
const ALLOWED_LICENSES = ["CC0", "Public domain"];

export async function searchWikimediaVideos({ query, maxResults = 5, fetchImpl = fetch }) {
  if (!query?.trim()) throw new Error("Nicho de busca obrigatório");
  const url = new URL(API_URL);
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrsearch: `${query} filetype:video`,
    gsrnamespace: "6",
    gsrlimit: "10",
    prop: "imageinfo",
    iiprop: "url|mime|mediatype|extmetadata",
    iiextmetadatafilter: "LicenseShortName|LicenseUrl|UsageTerms|Artist|Credit|AttributionRequired|Restrictions",
    iiextmetadatalanguage: "pt-br",
  });

  const response = await fetchImpl(url, {
    headers: { "User-Agent": "MKTauto/0.1 (local evaluation)" },
  });
  if (!response.ok) throw new Error(`Wikimedia Commons API respondeu ${response.status}`);
  const body = await response.json();
  const pages = Object.values(body.query?.pages ?? {}).sort((left, right) => left.index - right.index);

  return pages.map(toSource).filter(Boolean).slice(0, maxResults);
}

function toSource(page) {
  const info = page.imageinfo?.[0];
  const metadata = info?.extmetadata ?? {};
  const license = plain(metadata.LicenseShortName?.value);
  const restrictions = plain(metadata.Restrictions?.value);
  const allowed = ALLOWED_LICENSES.includes(license) || /^CC BY \d/.test(license);
  if (!officialUrl(info?.url, "upload.wikimedia.org")
    || !officialUrl(info?.descriptionurl, "commons.wikimedia.org")
    || !allowed
    || restrictions) return null;
  if (!(info.mime?.startsWith("video/") || info.mime === "application/ogg")) return null;

  return {
    id: `commons:${page.pageid}`,
    platform: "wikimedia-commons",
    title: page.title.replace(/^File:/, ""),
    creator: plain(metadata.Artist?.value || metadata.Credit?.value),
    sourceUrl: info.descriptionurl,
    downloadUrl: info.url,
    mimeType: info.mime,
    declaredLicense: license,
    licenseUrl: metadata.LicenseUrl?.value ?? null,
    usageTerms: plain(metadata.UsageTerms?.value),
    attributionRequired: metadata.AttributionRequired?.value === "true" || /^CC BY \d/.test(license),
    rightsState: "candidate",
    reviewDecision: "pending",
  };
}

function officialUrl(value, hostname) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === hostname;
  } catch {
    return false;
  }
}

function plain(value = "") {
  return String(value).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}
