import { NestFactory } from '@nestjs/core';
import { isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AppModule } from './app.module.js';

export function validateConfiguration(env: NodeJS.ProcessEnv) {
  const database = env.PROJECT_API_DATABASE;
  if (!database || !isAbsolute(database))
    throw new Error('PROJECT_API_DATABASE must be an explicit absolute path');
  const rawPort = env.PORT ?? '3000';
  if (!/^\d+$/.test(rawPort) || Number(rawPort) > 65535)
    throw new Error('PORT must be an integer between 0 and 65535');
  if (env.SOCIAL_HISTORY_DATABASE && !isAbsolute(env.SOCIAL_HISTORY_DATABASE))
    throw new Error(
      'SOCIAL_HISTORY_DATABASE must be an explicit absolute path',
    );
  // Startup only reads; provisioning requires the separate administrative command.
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    if (
      db.prepare('PRAGMA user_version').get()?.user_version !== 41 ||
      db.prepare('SELECT name FROM schema_migrations WHERE version=41').get()
        ?.name !== '041_campaign_orchestration'
    )
      throw new Error('SCHEMA_41_REQUIRED: run db:provision explicitly');
    db.prepare('SELECT adjustment_id FROM cost_adjustments LIMIT 0').all();
    db.prepare(
      'SELECT execution_id,claim_token FROM campaign_executions LIMIT 0',
    ).all();
    db.prepare(
      'SELECT sequence,evidence_json FROM campaign_execution_events LIMIT 0',
    ).all();
  } finally {
    db.close();
  }
  return { port: Number(rawPort) };
}

export async function bootstrap(env: NodeJS.ProcessEnv = process.env) {
  const { port } = validateConfiguration(env);
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
  try {
    await app.listen(port);
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
