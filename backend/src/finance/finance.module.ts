import { Module } from '@nestjs/common';
import { FinanceService } from './application/finance.service.js';
import { FinanceSession } from './infrastructure/finance.session.js';
import { FinanceController } from './finance.controller.js';
export const FINANCE_DATABASE = Symbol('FINANCE_DATABASE');

@Module({
  controllers: [FinanceController],
  providers: [
    {
      provide: FINANCE_DATABASE,
      useFactory: () => process.env.PROJECT_API_DATABASE ?? null,
    },
    {
      provide: FinanceService,
      inject: [FINANCE_DATABASE],
      useFactory: (path: string | null) =>
        new FinanceService({
          open: () => {
            if (!path)
              throw new Error(
                'PROJECT_API_DATABASE must be an explicit absolute path',
              );
            return new FinanceSession(path);
          },
        }),
    },
  ],
  exports: [FinanceService],
})
export class FinanceModule {}
