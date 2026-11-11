// Mutations have no retries. The service must persist intent before invoking
// either POST. Status/reconciliation are read-only and never recreate media.
export class SocialPublisherPort {
  [key: string]: any;
  createContainer(): any {
    throw new Error('createContainer não implementado');
  }
  getContainerStatus(): any {
    throw new Error('getContainerStatus não implementado');
  }
  publish(): any {
    throw new Error('publish não implementado');
  }
}
export function requireSocialPublisherPort(port: any): any {
  if (
    !port ||
    ['createContainer', 'getContainerStatus', 'publish'].some(
      (k: any): any => typeof port[k] !== 'function',
    )
  )
    throw new TypeError('SocialPublisherPort obrigatório');
  return port;
}
