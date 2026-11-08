import type { FacebookPublicationPorts } from '../application/ports/destination-publication.port.js';
import type { PublishingService } from '../application/publishing.service.js';
import type { PublishingMedia } from '../application/publishing.port.js';
import type { LocalFlowService } from '../../media/application/local-flow.service.js';
import { FacebookReelsAdapter } from './facebook-reels.adapter.js';
import { inspectFacebookMp4 } from './facebook-media-profile.adapter.js';
import { createHash } from 'node:crypto';
import { socialFail } from '../domain/social-publication-contracts.js';

export function facebookPublicationPorts(
  env: Record<string, string | undefined>,
  publishing: Pick<PublishingService, 'package'>,
  media: PublishingMedia,
  local: Pick<LocalFlowService, 'previewBytes'>,
): FacebookPublicationPorts | null {
  if (!env.FACEBOOK_PUBLICATION_MODE) return null;
  if (env.FACEBOOK_PUBLICATION_MODE !== 'live')
    socialFail('SOCIAL_OFFLINE_TRANSPORT_REQUIRED');
  const publisher = new FacebookReelsAdapter({
    pageId: env.FACEBOOK_PAGE_ID ?? '',
    apiVersion: env.FACEBOOK_API_VERSION ?? '',
    mode: 'live',
    getAccessToken: () => env.FACEBOOK_PAGE_ACCESS_TOKEN ?? '',
    getAppAccessToken: () => env.FACEBOOK_APP_ACCESS_TOKEN ?? '',
    fetch: globalThis.fetch,
    allowLivePosts: env.FACEBOOK_LIVE_POSTS_ENABLED === 'true',
  });
  const inspected = new Map<
    string,
    { contentHash: string; result: string; policyVersion: string }
  >();
  const bytes = async (hash: string, renderId: string, expected: string) => {
    const p = publishing.package(hash);
    if (
      !p ||
      p.platform !== 'facebook' ||
      p.identity.videoRenderId !== renderId ||
      p.identity.videoRenderContentHash !== expected ||
      media.verifyMedia(p.mediaReference) !== expected
    )
      socialFail('SOCIAL_MEDIA_INCOMPATIBLE');
    const value = await local.previewBytes(renderId);
    if (createHash('sha256').update(value).digest('hex') !== expected)
      socialFail('SOCIAL_MEDIA_INCOMPATIBLE');
    const profile = await inspectFacebookMp4(value);
    inspected.set(p.mediaReference, profile);
    return value;
  };
  return {
    publisher,
    localBytes: bytes,
    media: {
      inspect: async (reference: string) => {
        const profile = inspected.get(reference);
        if (!profile || profile.contentHash !== media.verifyMedia(reference))
          socialFail('SOCIAL_MEDIA_INCOMPATIBLE');
        return profile;
      },
    },
    verifyConnection: () => publisher.verifyConnection(),
    transfer: async () => socialFail('SOCIAL_LOCAL_MEDIA_REQUIRED'),
    verifier: {
      mode: 'live',
      verifyTransfer: async () => socialFail('SOCIAL_LOCAL_MEDIA_REQUIRED'),
      verifyPublication: async () => socialFail('SOCIAL_LOCAL_MEDIA_REQUIRED'),
    },
    allowLivePosts: env.FACEBOOK_LIVE_POSTS_ENABLED === 'true',
  };
}
