import { FacebookReelsAdapter } from './infrastructure/facebook-reels.adapter.js';
import { facebookPublicationFixture } from '../../test/support/facebook-publication.fixture.js';
import type { FacebookCreateAcknowledgement } from './domain/facebook-upload-session.js';

async function interrupted() {
  const f = await facebookPublicationFixture(true, 'v27.0');
  f.approve(f.facebookPackage);
  f.fail('create');
  await expect(f.execute()).rejects.toMatchObject({
    code: 'SOCIAL_RECONCILIATION_REQUIRED',
  });
  f.fail(undefined);
  const op = f
    .reopen()
    .status(f.execution.execution_id)
    .find((r) => r.network === 'FACEBOOK_REELS')!.operation;
  const ack: FacebookCreateAcknowledgement = {
    operationId: op.operationId,
    packageHash: f.facebookPackage.contentHash,
    pageId: '1355505384315575',
    videoId: '987654321',
    uploadVersion: 'v27.0',
    startedAt: f.at,
    acknowledgedAt: f.at,
    createSubmissions: 1,
    uploadSubmissions: 0,
    publicationSubmissions: 0,
    httpStatus: 200,
    evidenceHash: 'a'.repeat(64),
  };
  return { f, op, ack };
}

test('new cross-version sessions persist the exact original URL and response provenance', async () => {
  const f = await facebookPublicationFixture(true, 'v27.0');
  try {
    f.approve(f.facebookPackage);
    f.setProcessing(false);
    await expect(f.execute()).rejects.toThrow();
    const op = f
      .reopen()
      .status(f.execution.execution_id)
      .find((r) => r.network === 'FACEBOOK_REELS')!.operation;
    expect(op.uploadUri).toBe(
      'https://rupload.facebook.com/video-upload/v27.0/987654321',
    );
    expect(op.sessionEvidence).toMatchObject({
      source: 'META_CREATE_RESPONSE',
      graphVersion: 'v26.0',
      originalUrlRecovered: true,
    });
    expect(f.posts).toEqual(['create', 'upload', 'publish']);
  } finally {
    f.cleanup();
  }
});

test('documented recovery preserves the remote session across restart without another CREATE', async () => {
  const { f, op, ack } = await interrupted();
  try {
    const review = f.publishing.packageReview(f.facebookPackage.contentHash);
    const recovered = await f
      .reopen()
      .reconcileFacebookSession(
        f.execution.execution_id,
        '1355505384315575',
        ack,
      );
    expect(recovered.state).toBe('PROCESSING');
    expect(recovered.uploadStage).toBe('PENDING');
    expect(recovered.containerId).toBe(ack.videoId);
    expect(recovered.operationId).toBe(op.operationId);
    expect(recovered.sessionEvidence).toMatchObject({
      source: 'DOCUMENTED_RECOVERY',
      originalUrlRecovered: false,
      evidenceHash: ack.evidenceHash,
    });
    expect(f.posts).toEqual(['create']);
    expect(
      await f
        .reopen()
        .reconcileFacebookSession(
          f.execution.execution_id,
          '1355505384315575',
          ack,
        ),
    ).toEqual(recovered);
    await expect(f.execute(f.reopen())).rejects.toMatchObject({
      code: 'SOCIAL_RECONCILIATION_REQUIRED',
    });
    await expect(f.execute(f.reopen())).rejects.toMatchObject({
      code: 'SOCIAL_RECONCILIATION_REQUIRED',
    });
    expect(f.posts).toEqual(['create']);
    expect(f.publishing.packageReview(f.facebookPackage.contentHash)).toEqual(
      review,
    );
    expect(f.f.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    f.cleanup();
  }
});

test.each([
  'expired',
  'uploaded',
  'published',
  'bytes',
  'unknown',
  'owner',
  'identity',
  'local-upload',
  'package',
])(
  'uncertain recovery rejects %s without any POST or state advancement',
  async (kind) => {
    const { f, op, ack } = await interrupted();
    try {
      const inspect = f.ports.publisher.inspectUploadSession!.bind(
        f.ports.publisher,
      );
      vi.spyOn(f.ports.publisher, 'inspectUploadSession').mockImplementation(
        async (id) => {
          const s = await inspect(id);
          if (kind === 'expired') s.videoStatus = 'expired';
          if (kind === 'uploaded') s.uploadStatus = 'complete';
          if (kind === 'published') s.publicationStatus = 'complete';
          if (kind === 'bytes') s.bytesTransferred = 1;
          if (kind === 'unknown') s.uploadStatus = 'unknown';
          if (kind === 'owner') s.pageId = '999999999';
          if (kind === 'identity') s.videoId = '111111111';
          return s;
        },
      );
      if (kind === 'local-upload') Object.assign(ack, { uploadSubmissions: 1 });
      if (kind === 'package') ack.packageHash = 'b'.repeat(64);
      await expect(
        f
          .reopen()
          .reconcileFacebookSession(
            f.execution.execution_id,
            '1355505384315575',
            ack,
          ),
      ).rejects.toThrow();
      expect(f.posts).toEqual(['create']);
      const persisted = f
        .reopen()
        .status(f.execution.execution_id)
        .find((r) => r.network === 'FACEBOOK_REELS')!.operation;
      expect(persisted).toEqual(op);
    } finally {
      f.cleanup();
    }
  },
);

test('documented recovery only sends after a fresh verified zero-byte observation', async () => {
  const { f, op, ack } = await interrupted();
  try {
    await f
      .reopen()
      .reconcileFacebookSession(f.execution.execution_id, ack.pageId, ack);
    const observer = new FacebookReelsAdapter({
      pageId: ack.pageId,
      apiVersion: 'v26.0',
      mode: 'fake',
      getAccessToken: () => 'fixture',
      getAppAccessToken: () => 'fixture',
      fetch: async () =>
        new Response(
          JSON.stringify({
            id: ack.videoId,
            from: { id: ack.pageId },
            created_time: f.at,
            status: {
              video_status: 'uploading',
              uploading_phase: {
                status: 'in_progress',
                bytes_transferred: 0,
                bytes_transfered: 0,
              },
              processing_phase: { status: 'not_started' },
              publishing_phase: { status: 'not_started' },
            },
          }),
        ),
    });
    vi.spyOn(f.ports.publisher, 'inspectUploadSession').mockImplementation(
      (id) => observer.inspectUploadSession(id),
    );
    await f.execute(f.reopen());
    await f.execute(f.reopen());
    expect(f.posts).toEqual(['create', 'upload', 'publish']);
    const current = f
      .reopen()
      .status(f.execution.execution_id)
      .find((x) => x.network === 'FACEBOOK_REELS')!.operation;
    expect(current.operationId).toBe(op.operationId);
    expect(current.sessionEvidence.originalUrlRecovered).toBe(false);
  } finally {
    f.cleanup();
  }
});

test.each([
  { bytes_transferred: 0, bytes_transfered: 100 },
  { bytes_transferred: 100, bytes_transfered: 0 },
  { bytes_transferred: 100, bytes_transfered: 100 },
  {},
])('raw progress cannot authorize resend %j', async (fields) => {
  const { f, ack } = await interrupted();
  try {
    await f
      .reopen()
      .reconcileFacebookSession(f.execution.execution_id, ack.pageId, ack);
    const adapter = new FacebookReelsAdapter({
      pageId: ack.pageId,
      apiVersion: 'v26.0',
      mode: 'fake',
      getAccessToken: () => 'fixture',
      getAppAccessToken: () => 'fixture',
      fetch: async () =>
        new Response(
          JSON.stringify({
            id: ack.videoId,
            from: { id: ack.pageId },
            created_time: f.at,
            status: {
              video_status: 'uploading',
              uploading_phase: { status: 'in_progress', ...fields },
              processing_phase: { status: 'not_started' },
              publishing_phase: { status: 'not_started' },
            },
          }),
        ),
    });
    vi.spyOn(f.ports.publisher, 'inspectUploadSession').mockImplementation(
      (id) => adapter.inspectUploadSession(id),
    );
    await expect(f.execute(f.reopen())).rejects.toMatchObject({
      code: 'SOCIAL_RECONCILIATION_REQUIRED',
    });
    expect(f.posts).toEqual(['create']);
  } finally {
    f.cleanup();
  }
});
