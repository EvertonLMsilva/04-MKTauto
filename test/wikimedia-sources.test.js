import test from "node:test";
import assert from "node:assert/strict";
import { searchWikimediaVideos } from "../src/adapters/wikimedia-sources.js";

test("aceita somente vídeo com licença permissiva e download oficial", async () => {
  let requestedUrl;
  const fetchImpl = async (url) => {
    requestedUrl = new URL(url);
    return { ok: true, json: async () => ({ query: { pages: {
      1: page(1, "CC BY 4.0", "video/webm"),
      2: page(2, "CC BY-SA 4.0", "video/webm"),
      3: page(3, "CC0", "video/webm"),
    } } }) };
  };

  const result = await searchWikimediaVideos({ query: "motorcycle", fetchImpl });

  assert.match(requestedUrl.searchParams.get("gsrsearch"), /filetype:video/);
  assert.deepEqual(result.map((item) => item.declaredLicense), ["CC BY 4.0", "CC0"]);
  assert.equal(result[0].rightsState, "candidate");
  assert.match(result[0].downloadUrl, /upload\.wikimedia\.org/);
});

function page(id, license, mime) {
  return {
    pageid: id,
    index: id,
    title: `File:Video ${id}.webm`,
    imageinfo: [{
      url: `https://upload.wikimedia.org/video-${id}.webm`,
      descriptionurl: `https://commons.wikimedia.org/wiki/File:Video_${id}.webm`,
      mime,
      extmetadata: {
        LicenseShortName: { value: license },
        LicenseUrl: { value: "https://license.example" },
        Artist: { value: "Autor" },
      },
    }],
  };
}
