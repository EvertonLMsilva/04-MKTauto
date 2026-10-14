import type { MediaService } from '../../media/application/media.service.js';
export type PublishingMedia = Pick<
  MediaService,
  'getVideoRender' | 'verifyMedia' | 'report'
>;
export interface PublishingSession {
  manual: any;
  approvals: any;
  close(): void;
}
export interface PublishingStore {
  open(readOnly?: boolean): PublishingSession;
  social<T>(action: (repository: any) => T): T;
}
