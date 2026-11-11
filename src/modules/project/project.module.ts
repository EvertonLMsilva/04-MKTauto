import { Module } from '@nestjs/common';
import { ProjectController } from './project.controller.js';
import { ProjectService } from './application/project.service.js';
import { PROJECT_COMMANDS } from './application/ports/project-commands.port.js';
import { ProjectCommandService } from './application/project-command.service.js';
import { PROJECT_REPOSITORY } from './application/ports/project-repository.port.js';
import { SqliteProjectPersistence } from './infrastructure/sqlite-project.persistence.js';
import { PROJECT_SNAPSHOT_READER } from './application/ports/project-snapshot-reader.port.js';
import { PROJECT_DATABASE } from './infrastructure/project-database.config.js';

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
export class ProjectModule {}
