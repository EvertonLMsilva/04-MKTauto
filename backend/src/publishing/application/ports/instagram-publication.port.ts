export interface InstagramPublicationPorts {
  publisher: {
    mode: 'fake' | 'live';
    accountId: string;
    createContainer(input: any): Promise<any>;
    createResumableContainer?(input: any): Promise<any>;
    uploadResumableBytes?(uri: string, bytes: Buffer): Promise<any>;
    getContainerStatus(input: any): Promise<any>;
    publish(input: any): Promise<any>;
    getMedia(input: any): Promise<any>;
  };
  media: { inspect(reference: string): Promise<any> };
  // Transfer capability stays transient; only version/hash evidence is persisted.
  transfer(
    packageHash: string,
  ): Promise<{ url: string; expiresAt: string; contentHash: string }>;
  localBytes?(
    packageHash: string,
    renderId: string,
    expectedHash: string,
  ): Promise<Buffer>;
  verifyConnection?(): Promise<void>;
  verifier: {
    mode: 'fake' | 'live';
    verifyTransfer(value: any): Promise<any>;
    verifyPublication(evidence: any, hash: string): Promise<any>;
  };
  allowLivePosts?: boolean;
}
export const INSTAGRAM_PUBLICATION_PORTS = Symbol(
  'INSTAGRAM_PUBLICATION_PORTS',
);
