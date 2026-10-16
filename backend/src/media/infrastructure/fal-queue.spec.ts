import { test } from 'vitest';
import assert from 'node:assert/strict';
import { FalQueueClient, FAL_VIDEO_ENDPOINT } from './fal-queue.js';
const id = 'request-001';
const base = `https://queue.fal.run/minimax/h3-max-turbo/requests/${id}`;
function response(
  body: any,
  contentType: any = 'application/json',
  status: any = 200,
) {
  return new Response(
    contentType === 'application/json' ? JSON.stringify(body) : body,
    { status, headers: { 'content-type': contentType } },
  );
}
test('official submit handle is used for authenticated GET; media download has no credentials', async () => {
  const calls: any[] = [];
  const bodies = [
    response({
      request_id: id,
      status_url: `${base}/status`,
      response_url: base,
    }),
    response({ request_id: id, status: 'IN_PROGRESS' }),
    response({ video: { url: 'https://v3.fal.media/file.mp4' } }),
    response('original', 'video/mp4'),
  ];
  const queue = new FalQueueClient(
    { apiKey: 'secret' },
    {
      fetchImpl: async (url: any, options: any) => {
        calls.push({ url, options });
        return bodies.shift();
      },
    },
  );
  const handle = await queue.submit({
    prompt: 'Produto',
    image_url: 'https://example.com/image.png',
  });
  assert.equal(calls[0].url, `https://queue.fal.run/${FAL_VIDEO_ENDPOINT}`);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.authorization, 'Key secret');
  assert.equal(
    (await queue.status(id, { url: handle.statusUrl })).status,
    'IN_PROGRESS',
  );
  const result = await queue.result(id, { url: handle.responseUrl });
  assert.equal((await queue.download(result.video.url)).toString(), 'original');
  assert.equal(calls.filter((c: any) => c.options.method === 'POST').length, 1);
  assert.deepEqual(calls[3].options.headers, {});
});
test('transport refuses untrusted URLs, mismatched ID and oversized response without retries', async () => {
  let calls = 0;
  const queue = new FalQueueClient(
    { apiKey: 'secret', maxResponseBytes: 100 },
    {
      fetchImpl: async () => {
        calls++;
        return response({ request_id: 'other', status: 'COMPLETED' });
      },
    },
  );
  await assert.rejects(queue.status(id, { url: 'https://evil.test/' }));
  assert.equal(calls, 0);
  await assert.rejects(queue.download('https://fal.media.evil.test/file.mp4'));
  assert.equal(calls, 0);
  await assert.rejects(queue.status(id, { url: `${base}/status` }));
  assert.equal(calls, 1);
  const large = new FalQueueClient(
    { apiKey: 'secret', maxResponseBytes: 1 },
    { fetchImpl: async () => response({ value: 'large' }) },
  );
  await assert.rejects(
    large.submit({}),
    (error: any) => error.code === 'PROVIDER_RESPONSE_TOO_LARGE',
  );
});
test('POST network errors and HTTP failures execute only once', async () => {
  for (const failure of [
    async () => {
      throw new Error('secret');
    },
    async () => response({}, 'application/json', 503),
  ]) {
    let calls = 0;
    const queue = new FalQueueClient(
      { apiKey: 'secret' },
      {
        fetchImpl: async () => {
          calls++;
          return failure();
        },
      },
    );
    await assert.rejects(
      queue.submit({}),
      (error: any) => !error.message.includes('secret'),
    );
    assert.equal(calls, 1);
  }
});
test('FIX01 invalid convenience endpoints are discarded, identity retained and official recovery validated', async () => {
  const calls: any[] = [];
  const queue = new FalQueueClient(
    { apiKey: 'secret' },
    {
      fetchImpl: async (url: any, options: any) => {
        calls.push(url);
        return options.method === 'POST'
          ? response({
              request_id: id,
              status_url: 'https://evil.test/?token=secret',
              response_url: 'https://evil.test/result',
            })
          : response({ video: { url: 'https://v3.fal.media/file.mp4' } });
      },
    },
  );
  const handle = await queue.submit({});
  assert.equal(handle.requestId, id);
  assert.equal(handle.reconciliationPending, true);
  assert.equal(handle.statusUrl, null);
  assert.equal(handle.responseUrl, null);
  await queue.result(id, { url: handle.responseUrl });
  assert.equal(calls[1], base);
  await assert.rejects(queue.result(id, { url: 'https://evil.test/result' }));
  await assert.rejects(queue.result('../bad'));
  assert.equal(calls.length, 2);
});
