import { socialFail } from './social-publication-contracts.js';

export const FACEBOOK_LOCAL_UPLOAD_CONTRACT =
  'https://www.postman.com/meta/facebook/request/ps1ahe4/2-a-upload-local-reel';

// Graph calls and the server-selected rupload endpoint have separate versions.
// Preserve the exact returned string; query/opaque parameters are not supported.
export function validateFacebookUploadUri(
  uri: unknown,
  videoId: string,
  graphVersion: string,
): string {
  if (typeof uri !== 'string' || !/^\d{5,64}$/.test(videoId))
    socialFail('SOCIAL_UPLOAD_URI_INVALID');
  const match =
    /^https:\/\/rupload\.facebook\.com\/video-upload\/(v\d{2}\.0)\/(\d{5,64})$/.exec(
      uri,
    );
  if (
    !match ||
    match[2] !== videoId ||
    ![graphVersion, 'v26.0', 'v27.0'].includes(match[1])
  )
    socialFail('SOCIAL_UPLOAD_URI_INVALID');
  return uri;
}

export interface FacebookSessionObservation {
  videoId: string;
  pageId: string;
  createdAt: string;
  observedAt: string;
  graphVersion: string;
  videoStatus: string;
  uploadStatus: string;
  processingStatus: string;
  publicationStatus: string;
  bytesTransferred: number | null;
  progress: 'CONSISTENT' | 'CONFLICT' | 'UNKNOWN';
  fields: Record<string, RemoteField<unknown>>;
}

// Captured operational CREATE acknowledgement, not a reconstructed Meta body.
export interface FacebookCreateAcknowledgement {
  operationId: string;
  packageHash: string;
  pageId: string;
  videoId: string;
  uploadVersion: 'v26.0' | 'v27.0';
  startedAt: string;
  acknowledgedAt: string;
  createSubmissions: 1;
  uploadSubmissions: 0;
  publicationSubmissions: 0;
  httpStatus: 200;
  evidenceHash: string;
}

export type RemoteField<T> =
  { present: false } | { present: true; value: T | null };
export type UploadTransportEvent = {
  kind:
    | 'ATTEMPT_STARTED'
    | 'HTTP_RESPONSE'
    | 'RESPONSE_UNKNOWN'
    | 'OBSERVED_FAILURE'
    | 'TRANSFER_CONFIRMED';
  at: string;
  method: 'POST';
  requestType: 'UPLOAD';
  destination: string;
  payloadSize: number;
  httpStatus?: number;
  error?:
    | 'TIMEOUT'
    | 'NETWORK'
    | 'INVALID_RESPONSE'
    | 'HTTP_REJECTED'
    | 'UNCONFIRMED';
};
export type UploadTransportObserver = (
  event: UploadTransportEvent,
) => void | Promise<void>;

// No audit means no observed transport attempt; it is not proof of remote zero bytes.
export function classifyUploadAudit(
  events: readonly Pick<UploadTransportEvent, 'kind'>[] = [],
):
  | 'NOT_ATTEMPTED'
  | 'ATTEMPT_STARTED'
  | 'RESPONSE_UNKNOWN'
  | 'OBSERVED_FAILURE'
  | 'TRANSFER_CONFIRMED' {
  const last = events.at(-1)?.kind;
  if (!last) return 'NOT_ATTEMPTED';
  return last === 'HTTP_RESPONSE' ? 'RESPONSE_UNKNOWN' : last;
}
