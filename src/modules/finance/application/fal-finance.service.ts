import type { FalGenerationRepository } from '../infrastructure/fal-generation.repository.js';

export class FalFinanceService {
  constructor(private readonly store: { open(): FalGenerationRepository }) {}
  private session<T>(operation: (jobs: FalGenerationRepository) => T): T {
    const jobs = this.store.open();
    try {
      return operation(jobs);
    } finally {
      jobs.close();
    }
  }
  reserve(input: Parameters<FalGenerationRepository['reserve']>[0]) {
    return this.session((j) => j.reserve(input));
  }
  get(key: string) {
    return this.session((j) => j.get(key));
  }
  getByAcquisitionRequest(id: string) {
    return this.session((j) => j.getByAcquisitionRequest(id));
  }
  getRequestBinding(id: string) {
    return this.session((j) => j.getRequestBinding(id));
  }
  submitted(key: string, id: string, result: unknown) {
    return this.session((j) => j.submitted(key, id, result));
  }
  uncertain(key: string) {
    return this.session((j) => j.uncertain(key));
  }
  state(key: string, state: string) {
    return this.session((j) => j.state(key, state));
  }
  complete(key: string, output: unknown) {
    return this.session((j) => j.complete(key, output));
  }
  recordObservedCost(key: string, observation: unknown) {
    return this.session((j) => j.recordObservedCost(key, observation));
  }
}
