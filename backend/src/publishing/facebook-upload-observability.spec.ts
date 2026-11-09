import { classifyUploadAudit } from './domain/facebook-upload-session.js';
import { facebookPublicationFixture } from '../../test/support/facebook-publication.fixture.js';
import { FacebookReelsAdapter } from './infrastructure/facebook-reels.adapter.js';
const make = (fetch: any) =>
  new FacebookReelsAdapter({
    pageId: '1355505384315575',
    apiVersion: 'v26.0',
    mode: 'fake',
    getAccessToken: () => 'SECRET',
    getAppAccessToken: () => 'SECRET',
    fetch,
  });
const uri = 'https://rupload.facebook.com/video-upload/v27.0/987654321';
test('observer persists start before transport and distinguishes HTTP confirmation', async () => {
  const events: any[] = [];
  const a = make(async () => {
    expect(events[0].kind).toBe('ATTEMPT_STARTED');
    return new Response('{"success":true}');
  });
  await a.uploadResumableBytes(uri, Buffer.from('abc'), '987654321', (e) => {
    events.push(e);
  });
  expect(events.map((e) => e.kind)).toEqual([
    'ATTEMPT_STARTED',
    'HTTP_RESPONSE',
    'TRANSFER_CONFIRMED',
  ]);
  expect(JSON.stringify(events)).not.toContain('SECRET');
});
test('persistence failure before HTTP prevents sending', async () => {
  const fetch = vi.fn();
  const a = make(fetch);
  await expect(
    a.uploadResumableBytes(uri, Buffer.from('abc'), '987654321', () => {
      throw Error('DB_FAILURE');
    }),
  ).rejects.toThrow('DB_FAILURE');
  expect(fetch).not.toHaveBeenCalled();
});
test('lost response is unknown, not confirmed', async () => {
  const events: any[] = [];
  const a = make(async () => {
    throw new DOMException('secret', 'TimeoutError');
  });
  await expect(
    a.uploadResumableBytes(uri, Buffer.from('abc'), '987654321', (e) => {
      events.push(e);
    }),
  ).rejects.toThrow();
  expect(events.map((e) => e.kind)).toEqual([
    'ATTEMPT_STARTED',
    'RESPONSE_UNKNOWN',
  ]);
  expect(events[1].error).toBe('TIMEOUT');
  expect(JSON.stringify(events)).not.toContain('secret');
});
test.each([undefined, null, 0, 12])(
  'remote bytes retain presence/value %s',
  async (bytes) => {
    const phase: any = { status: 'in_progress' };
    if (bytes !== undefined) phase.bytes_transferred = bytes;
    const a = make(
      async () =>
        new Response(
          JSON.stringify({
            id: '987654321',
            from: { id: '1355505384315575' },
            created_time: '2026-11-09T00:00:00Z',
            status: {
              video_status: 'uploading',
              uploading_phase: phase,
              processing_phase: { status: 'not_started' },
              publishing_phase: { status: 'not_started' },
            },
          }),
        ),
    );
    const o = await a.inspectUploadSession('987654321');
    expect(o.fields.bytesTransferred).toEqual(
      bytes === undefined
        ? { present: false }
        : { present: true, value: bytes },
    );
  },
);

test.each([false, true])(
  'SQLite audit survives restart; failed response=%s',
  async (fail) => {
    const f = await facebookPublicationFixture(true, 'v27.0');
    try {
      f.approve(f.facebookPackage);
      if (fail) f.fail('upload');
      try {
        await f.execute();
      } catch {}
      const op = f
        .reopen()
        .status(f.execution.execution_id)
        .find((x) => x.network === 'FACEBOOK_REELS')!.operation;
      expect(op.uploadAudit.map((x: any) => x.kind)).toEqual(
        fail
          ? ['ATTEMPT_STARTED', 'RESPONSE_UNKNOWN']
          : ['ATTEMPT_STARTED', 'HTTP_RESPONSE', 'TRANSFER_CONFIRMED'],
      );
      expect(
        op.uploadAudit.every(
          (x: any) =>
            x.operationId === op.operationId && x.videoId === op.containerId,
        ),
      ).toBe(true);
      expect(op.transferEvidence !== null).toBe(!fail);
      const audit = op.uploadAudit;
      try {
        await f.execute(f.reopen());
      } catch {}
      expect(f.posts.filter((x) => x === 'upload')).toHaveLength(1);
      expect(f.posts.filter((x) => x === 'create')).toHaveLength(1);
      expect(
        f
          .reopen()
          .status(f.execution.execution_id)
          .find((x) => x.network === 'FACEBOOK_REELS')!.operation.uploadAudit,
      ).toEqual(audit);
    } finally {
      f.cleanup();
    }
  },
);
test('SQLite write failure prevents HTTP, interrupted intent cannot retry', async () => {
  const f = await facebookPublicationFixture(true, 'v27.0');
  try {
    f.approve(f.facebookPackage);
    const open = f.store.openDestination.bind(f.store);
    const spy = vi
      .spyOn(f.store, 'openDestination')
      .mockImplementation((mode) => {
        const store = open(mode),
          transition = store.social.transition.bind(store.social);
        store.social.transition = (...args: any[]) => {
          if (args.some((x) => x?.uploadAudit))
            throw Error('AUDIT_WRITE_FAILED');
          return (transition as any)(...args);
        };
        return store;
      });
    await expect(f.execute()).rejects.toThrow('AUDIT_WRITE_FAILED');
    expect(f.posts).toEqual(['create']);
    spy.mockRestore();
    await expect(f.execute(f.reopen())).rejects.toThrow();
    expect(f.posts).toEqual(['create']);
  } finally {
    f.cleanup();
  }
});
test('pre-transport validation failure never signals an attempt', async () => {
  const fetch = vi.fn(),
    observer = vi.fn();
  await expect(
    make(fetch).uploadResumableBytes(
      'https://evil.test',
      Buffer.from('abc'),
      '987654321',
      observer,
    ),
  ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  expect(observer).not.toHaveBeenCalled();
});
test.each([
  undefined,
  null,
  [],
  [{ code: 100, message: 'SECRET', error_subcode: 33 }],
])('remote errors retain presence and safe values %j', async (errors) => {
  const phase: any = { status: 'in_progress', source_file_size: 0 };
  if (errors !== undefined) phase.errors = errors;
  const a = make(
    async () =>
      new Response(
        JSON.stringify({
          id: '987654321',
          from: { id: '1355505384315575' },
          created_time: '2026-11-09T00:00:00Z',
          status: {
            video_status: 'uploading',
            uploading_phase: phase,
            processing_phase: { status: 'not_started' },
            publishing_phase: { status: 'not_started' },
          },
        }),
      ),
  );
  const o = await a.inspectUploadSession('987654321');
  expect(o.fields.uploadErrors.present).toBe(errors !== undefined);
  expect(o.fields.sourceFileSize).toEqual({ present: true, value: 0 });
  expect(JSON.stringify(o)).not.toContain('SECRET');
});

test('classification does not turn a response or missing evidence into confirmation', () => {
  expect(classifyUploadAudit()).toBe('NOT_ATTEMPTED');
  expect(classifyUploadAudit([{ kind: 'ATTEMPT_STARTED' }])).toBe(
    'ATTEMPT_STARTED',
  );
  expect(classifyUploadAudit([{ kind: 'HTTP_RESPONSE' }])).toBe(
    'RESPONSE_UNKNOWN',
  );
  expect(classifyUploadAudit([{ kind: 'TRANSFER_CONFIRMED' }])).toBe(
    'TRANSFER_CONFIRMED',
  );
});
test('observed HTTP rejection is recorded separately from transport loss', async () => {
  const events: any[] = [];
  const a = make(
    async () =>
      new Response('{"error":{"code":190,"message":"SECRET"}}', {
        status: 401,
      }),
  );
  await expect(
    a.uploadResumableBytes(uri, Buffer.from('abc'), '987654321', (e) => {
      events.push(e);
    }),
  ).rejects.toThrow();
  expect(events.map((e) => e.kind)).toEqual([
    'ATTEMPT_STARTED',
    'HTTP_RESPONSE',
    'OBSERVED_FAILURE',
  ]);
  expect(events[1].httpStatus).toBe(401);
  expect(JSON.stringify(events)).not.toContain('SECRET');
});
test('lost response body cannot confirm transfer', async () => {
  const events: any[] = [];
  const a = make(async () => new Response('not JSON'));
  await expect(
    a.uploadResumableBytes(uri, Buffer.from('abc'), '987654321', (e) => {
      events.push(e);
    }),
  ).rejects.toThrow();
  expect(events.at(-1)).toMatchObject({
    kind: 'RESPONSE_UNKNOWN',
    error: 'INVALID_RESPONSE',
  });
});

test('persisted audit prefix and historical session evidence cannot be overwritten', async () => {
  const f = await facebookPublicationFixture(true, 'v27.0');
  try {
    f.approve(f.facebookPackage);
    f.setProcessing(false);
    try {
      await f.execute();
    } catch {}
    const op = f
      .reopen()
      .status(f.execution.execution_id)
      .find((x) => x.network === 'FACEBOOK_REELS')!.operation;
    const store = f.store.openDestination('fake');
    try {
      expect(() =>
        store.social.transition(
          op.operationId,
          op.version,
          [op.state],
          { uploadAudit: [] },
          f.at,
        ),
      ).toThrow('SOCIAL_AUDIT_INVALID');
      expect(() =>
        store.social.transition(
          op.operationId,
          op.version,
          [op.state],
          {
            sessionEvidence: {
              ...op.sessionEvidence,
              originalUrlRecovered: false,
            },
          },
          f.at,
        ),
      ).toThrow('SOCIAL_SESSION_EVIDENCE_IMMUTABLE');
      expect(store.social.get(op.operationId).sessionEvidence).toEqual(
        op.sessionEvidence,
      );
    } finally {
      store.close();
    }
  } finally {
    f.cleanup();
  }
});

test('failure to persist HTTP response leaves durable started evidence and forbids replay', async () => {
  const f = await facebookPublicationFixture(true, 'v27.0');
  try {
    f.approve(f.facebookPackage);
    const open = f.store.openDestination.bind(f.store);
    const spy = vi
      .spyOn(f.store, 'openDestination')
      .mockImplementation((mode) => {
        const store = open(mode),
          transition = store.social.transition.bind(store.social);
        store.social.transition = (...args: any[]) => {
          if (
            args.some((x) => x?.uploadAudit?.at(-1)?.kind === 'HTTP_RESPONSE')
          )
            throw Error('RESULT_WRITE_FAILED');
          return (transition as any)(...args);
        };
        return store;
      });
    await expect(f.execute()).rejects.toThrow('RESULT_WRITE_FAILED');
    spy.mockRestore();
    const op = f
      .reopen()
      .status(f.execution.execution_id)
      .find((x) => x.network === 'FACEBOOK_REELS')!.operation;
    expect(op.uploadStage).toBe('UPLOADING');
    expect(classifyUploadAudit(op.uploadAudit)).toBe('ATTEMPT_STARTED');
    expect(op.transferEvidence).toBeNull();
    await expect(f.execute(f.reopen())).rejects.toThrow();
    expect(f.posts).toEqual(['create', 'upload']);
  } finally {
    f.cleanup();
  }
});

test.each([
  [{ bytes_transferred: 0, bytes_transfered: 100 }, 'CONFLICT', null],
  [{ bytes_transferred: 100, bytes_transfered: 0 }, 'CONFLICT', null],
  [{ bytes_transferred: 0, bytes_transfered: 0 }, 'CONSISTENT', 0],
  [{ bytes_transferred: 100, bytes_transfered: 100 }, 'CONSISTENT', 100],
  [{ bytes_transfered: 0 }, 'CONSISTENT', 0],
  [{}, 'UNKNOWN', null],
  [{ bytes_transferred: null, bytes_transfered: 0 }, 'CONFLICT', null],
])('raw progress consistency %j', async (values, progress, bytes) => {
  const a = make(
    async () =>
      new Response(
        JSON.stringify({
          id: '987654321',
          from: { id: '1355505384315575' },
          created_time: '2026-11-09T00:00:00Z',
          status: {
            video_status: 'uploading',
            uploading_phase: { status: 'in_progress', ...(values as object) },
            processing_phase: { status: 'not_started' },
            publishing_phase: { status: 'not_started' },
          },
        }),
      ),
  );
  const o = await a.inspectUploadSession('987654321');
  expect(o.progress).toBe(progress);
  expect(o.bytesTransferred).toBe(bytes);
  for (const [k, v] of Object.entries(values))
    expect(
      o.fields[
        k === 'bytes_transferred' ? 'bytesTransferred' : 'bytesTransfered'
      ],
    ).toEqual({ present: true, value: v });
});
test.each([-1, '0', {}, 1.2])(
  'invalid raw bytes cannot authorize %j',
  async (value) => {
    const a = make(
      async () =>
        new Response(
          JSON.stringify({
            id: '987654321',
            from: { id: '1355505384315575' },
            created_time: '2026-11-09T00:00:00Z',
            status: {
              video_status: 'uploading',
              uploading_phase: {
                status: 'in_progress',
                bytes_transferred: value,
              },
              processing_phase: { status: 'not_started' },
              publishing_phase: { status: 'not_started' },
            },
          }),
        ),
    );
    await expect(a.inspectUploadSession('987654321')).rejects.toThrow(
      'SOCIAL_SESSION_UNVERIFIED',
    );
  },
);
async function auditFixture() {
  const f = await facebookPublicationFixture(true, 'v27.0');
  f.approve(f.facebookPackage);
  vi.spyOn(f.ports.publisher, 'uploadResumableBytes').mockRejectedValueOnce(
    Error('BEFORE_HTTP'),
  );
  try {
    await f.execute();
  } catch {}
  const store = f.store.openDestination('fake');
  const op = f
    .reopen()
    .status(f.execution.execution_id)
    .find((x) => x.network === 'FACEBOOK_REELS')!.operation;
  const base = {
    kind: 'ATTEMPT_STARTED',
    at: '2026-11-09T00:00:00Z',
    method: 'POST',
    requestType: 'UPLOAD',
    destination: op.uploadUri,
    payloadSize: 3,
    attemptId: 'a'.repeat(36),
    operationId: op.operationId,
    videoId: op.containerId,
  };
  const append = (e: any) => {
    const current = store.social.get(op.operationId);
    return store.social.transition(
      op.operationId,
      current.version,
      [current.state],
      { uploadAudit: [...(current.uploadAudit ?? []), e] },
      f.at,
    );
  };
  return {
    f,
    store,
    op,
    base,
    append,
    cleanup: () => {
      store.close();
      f.cleanup();
    },
  };
}
test.each([undefined, null, NaN, 99, 600, '200'])(
  'reject HTTP response status %s',
  async (status) => {
    const x = await auditFixture();
    try {
      x.append(x.base);
      expect(() =>
        x.append({ ...x.base, kind: 'HTTP_RESPONSE', httpStatus: status }),
      ).toThrow('SOCIAL_AUDIT_INVALID');
      expect(x.store.social.get(x.op.operationId).uploadAudit).toEqual([
        x.base,
      ]);
    } finally {
      x.cleanup();
    }
  },
);
test.each([400, 500])('cannot confirm HTTP %s', async (status) => {
  const x = await auditFixture();
  try {
    x.append(x.base);
    x.append({ ...x.base, kind: 'HTTP_RESPONSE', httpStatus: status });
    expect(() =>
      x.append({ ...x.base, kind: 'TRANSFER_CONFIRMED', httpStatus: status }),
    ).toThrow('SOCIAL_AUDIT_INVALID');
  } finally {
    x.cleanup();
  }
});
test.each([
  'duplicate-response',
  'before-start',
  'regressive',
  'payload',
  'attempt',
  'video',
  'operation',
  'no-response',
  'prefix',
])('audit integrity rejects %s', async (scenario) => {
  const x = await auditFixture();
  try {
    x.append(x.base);
    const response = {
      ...x.base,
      kind: 'HTTP_RESPONSE',
      httpStatus: 200,
      at: '2026-11-09T00:00:02Z',
    };
    if (scenario === 'no-response') {
      expect(() =>
        x.append({ ...x.base, kind: 'TRANSFER_CONFIRMED', httpStatus: 200 }),
      ).toThrow();
      return;
    }
    if (scenario === 'before-start') {
      expect(() =>
        x.append({ ...response, at: '2026-11-08T23:59:59Z' }),
      ).toThrow();
      return;
    }
    if (scenario === 'prefix') {
      const current = x.store.social.get(x.op.operationId);
      expect(() =>
        x.store.social.transition(
          x.op.operationId,
          current.version,
          [current.state],
          { uploadAudit: [{ ...x.base, payloadSize: 4 }, response] },
          x.f.at,
        ),
      ).toThrow();
      return;
    }
    x.append(response);
    const confirmed = {
      ...response,
      kind: 'TRANSFER_CONFIRMED',
      at: '2026-11-09T00:00:03Z',
    };
    const bad =
      scenario === 'duplicate-response'
        ? response
        : scenario === 'regressive'
          ? { ...confirmed, at: '2026-11-09T00:00:01Z' }
          : scenario === 'payload'
            ? { ...confirmed, payloadSize: 4 }
            : scenario === 'attempt'
              ? { ...confirmed, attemptId: 'b'.repeat(36) }
              : scenario === 'video'
                ? { ...confirmed, videoId: '123456789' }
                : { ...confirmed, operationId: 'wrong' };
    expect(() => x.append(bad)).toThrow('SOCIAL_AUDIT_INVALID');
    expect(x.store.social.get(x.op.operationId).uploadAudit).toEqual([
      x.base,
      response,
    ]);
  } finally {
    x.cleanup();
  }
});
