import type { InstagramPublicationPorts } from './instagram-publication.port.js';
import type { ManualDistributionService } from '../manual-distribution.service.js';
export type PublicationNetwork = 'INSTAGRAM' | 'FACEBOOK_REELS';
export interface DestinationReservations {
  forExecution(
    id: string,
    network: PublicationNetwork,
    account: string,
  ): { operationId: string } | null;
  list(
    id: string,
  ): { operationId: string; network: PublicationNetwork; accountId: string }[];
  reserve(
    id: string,
    operation: any,
    pkg: any,
    reviewHash: string,
    at: string,
  ): unknown;
  authorize(operation: any, at: string): unknown;
}
export interface DestinationPublicationStore {
  readDestinations(
    id: string,
  ): {
    operationId: string;
    network: PublicationNetwork;
    accountId: string;
    operation: any;
  }[];
  openDestination(mode: 'fake' | 'live'): {
    manual: ManualDistributionService;
    social: any;
    reservations: DestinationReservations;
    close(): void;
  };
}
export type FacebookPublicationPorts = InstagramPublicationPorts & {
  localBytes: NonNullable<InstagramPublicationPorts['localBytes']>;
};
export const FACEBOOK_PUBLICATION_PORTS = Symbol('FACEBOOK_PUBLICATION_PORTS');
