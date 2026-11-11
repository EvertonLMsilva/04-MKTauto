import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { ProjectController } from './project.controller.js';
import { ProjectService } from './application/project.service.js';
import { PROJECT_COMMANDS } from './application/ports/project-commands.port.js';
import { ProjectCommandService } from './application/project-command.service.js';
import { PROJECT_REPOSITORY } from './application/ports/project-repository.port.js';
import { SqliteProjectPersistence } from './infrastructure/sqlite-project.persistence.js';
import { PROJECT_SNAPSHOT_READER } from './application/ports/project-snapshot-reader.port.js';
import { PROJECT_DATABASE } from './infrastructure/project-database.config.js';
import { PostgresModule } from '../../infrastructure/database/postgres/index.js';
import type { PostgresConfig } from '../../infrastructure/database/postgres/index.js';
import { PostgresProjectPersistence } from './infrastructure/postgres-project.persistence.js';

@Module({
  controllers: [ProjectController],
  exports: [PROJECT_SNAPSHOT_READER],
  providers: [
    ProjectService,
    SqliteProjectPersistence,
    { provide: PROJECT_REPOSITORY, useExisting: SqliteProjectPersistence },
    { provide: PROJECT_COMMANDS, useClass: ProjectCommandService },
    {
      provide: PROJECT_DATABASE,
      useFactory: () => process.env.PROJECT_API_DATABASE ?? null,
    },
    { provide: PROJECT_SNAPSHOT_READER, useExisting: SqliteProjectPersistence },
  ],
})
export class ProjectModule {
  /** Isolated opt-in; the operational module above continues to use SQLite. */
  static postgres(config: PostgresConfig): DynamicModule {
    return {
      module: PostgresProjectPilotModule,
      imports: [PostgresModule.register(config)],
      controllers: [ProjectController],
      providers: [
        ProjectService,
        PostgresProjectPersistence,
        {
          provide: PROJECT_REPOSITORY,
          useExisting: PostgresProjectPersistence,
        },
        {
          provide: PROJECT_SNAPSHOT_READER,
          useExisting: PostgresProjectPersistence,
        },
        {
          provide: PROJECT_COMMANDS,
          useFactory: (persistence: PostgresProjectPersistence) =>
            new ProjectCommandService<true>(persistence),
          inject: [PostgresProjectPersistence],
        },
      ],
      exports: [PROJECT_SNAPSHOT_READER],
    };
  }
}

@Module({})
class PostgresProjectPilotModule {}
