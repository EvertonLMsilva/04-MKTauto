import { Module, type DynamicModule } from '@nestjs/common';
import {
  PostgresModule,
  PostgresDatabase,
  type PostgresConfig,
} from '../../infrastructure/database/postgres/index.js';
import { PostgresFinanceLedgerPersistence } from './infrastructure/postgres-finance-ledger.persistence.js';

export const POSTGRES_FINANCE_LEDGER = Symbol('POSTGRES_FINANCE_LEDGER');
/** Internal opt-in only. No FinanceService/SQLite binding, controllers, policies or paid transports. */
@Module({})
export class FinancePostgresModule {
  static register(config: PostgresConfig): DynamicModule {
    return {
      module: FinancePostgresModule,
      imports: [PostgresModule.register(config)],
      providers: [
        {
          provide: PostgresFinanceLedgerPersistence,
          inject: [PostgresDatabase],
          useFactory: (db: PostgresDatabase) =>
            new PostgresFinanceLedgerPersistence(db),
        },
        {
          provide: POSTGRES_FINANCE_LEDGER,
          useExisting: PostgresFinanceLedgerPersistence,
        },
      ],
      exports: [POSTGRES_FINANCE_LEDGER, PostgresFinanceLedgerPersistence],
    };
  }
}
