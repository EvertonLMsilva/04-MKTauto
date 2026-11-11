import { createHash } from 'node:crypto';
import type { InstagramPublicationPorts } from '../application/ports/instagram-publication.port.js';
import type { PublishingService } from '../application/publishing.service.js';
import type { PublishingMedia } from '../application/publishing.port.js';
import { affiliateHash } from '../../affiliate/domain/affiliate-contracts.js';
import { socialFail } from '../domain/social-publication-contracts.js';
import { InstagramGraphAdapter } from './instagram-graph.adapter.js';

// Explicit offline mode only. The profile and hosting are simulations; executionMode=fake
// is sealed into every persisted operation and cannot be reused by a live transport.
export function deterministicInstagramPorts(
  publishing: Pick<PublishingService, 'package'>,
  media: PublishingMedia,
  account: string,
  version: string,
): InstagramPublicationPorts {
  const identity = (value: string) =>
    BigInt(`0x${createHash('sha256').update(value).digest('hex')}`)
      .toString()
      .slice(0, 18);
  const publisher = new InstagramGraphAdapter({
    mode: 'fake',
    accountId: account,
    apiVersion: version,
    getAccessToken: () => 'OFFLINE_FIXTURE',
    fetch: async (url, init) => {
      const u = url instanceof Request ? new URL(url.url) : new URL(url);
      const data =
        init?.method === 'POST'
          ? {
              id: identity(
                `${u.pathname}:${typeof init.body === 'string' ? init.body : ''}`,
              ),
            }
          : u.searchParams.get('fields') === 'status_code'
            ? { status_code: 'FINISHED' }
            : {
                id: u.pathname.split('/').at(-1),
                permalink: `https://www.instagram.com/reel/fake_${u.pathname.split('/').at(-1)}/`,
                timestamp: '2000-01-01T00:00:00Z',
              };
      return new Response(JSON.stringify(data));
    },
  });
  const check = (reference: string, hash: string) => {
    if (media.verifyMedia(reference) !== hash)
      socialFail('SOCIAL_MEDIA_INCOMPATIBLE');
  };
  return {
    publisher,
    media: {
      inspect: async (reference) => ({
        contentHash: media.verifyMedia(reference),
        result: 'PASS',
        policyVersion: 'instagram-reels-profile/1.0.0',
      }),
    },
    transfer: async (hash) => {
      const pkg = publishing.package(hash);
      if (!pkg) socialFail('SOCIAL_PACKAGE_REQUIRED');
      check(pkg.mediaReference, pkg.identity.videoRenderContentHash);
      return {
        url: `https://offline.invalid/${hash}`,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        contentHash: pkg.identity.videoRenderContentHash,
      };
    },
    verifier: {
      mode: 'fake',
      verifyTransfer: async (value) => {
        const url = new URL(value.url);
        if (url.origin !== 'https://offline.invalid')
          socialFail('SOCIAL_TRANSFER_INVALID');
        const pkg = publishing.package(url.pathname.slice(1));
        if (!pkg) socialFail('SOCIAL_PACKAGE_REQUIRED');
        check(pkg.mediaReference, value.contentHash);
        const proof = {
          executionMode: 'fake',
          contentHash: value.contentHash,
          reference: pkg.mediaReference,
        };
        return { ...proof, evidenceHash: affiliateHash(proof) };
      },
      verifyPublication: async (proof, hash) => {
        const { evidenceHash, ...body } = proof ?? {};
        if (
          body.executionMode !== 'fake' ||
          body.contentHash !== hash ||
          affiliateHash(body) !== evidenceHash
        )
          socialFail('SOCIAL_HOSTED_MEDIA_UNVERIFIED');
        check(body.reference, hash);
      },
    },
  };
}
