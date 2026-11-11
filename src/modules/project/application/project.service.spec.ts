import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ProjectService } from './project.service.js';
import { ProjectCommandError } from './ports/project-commands.port.js';
import { createProjectSnapshot } from '../domain/project-contracts.js';

const snapshot = createProjectSnapshot({
  id: 'project_001',
  name: 'Project',
  niche: 'Tecnologia',
  audience: { profile: 'Público' },
  channel: { publishing: { networks: ['instagram'] } },
});

describe('ProjectService', () => {
  it('reads the current snapshot without choosing a version', async () => {
    const get = vi.fn().mockResolvedValue(snapshot);
    expect(await new ProjectService({ get }).getCurrent('project_001')).toBe(
      snapshot,
    );
    expect(get).toHaveBeenCalledExactlyOnceWith('project_001', undefined);
  });

  it.each([
    ['EXPECTED_VERSION_MISMATCH', ConflictException],
    ['PROJECT_ARCHIVED', ConflictException],
    ['IDEMPOTENCY_KEY_REUSED', ConflictException],
    ['PROJECT_NOT_FOUND', NotFoundException],
    ['INVALID_ACTOR', BadRequestException],
  ])('maps command error %s', async (code, exception) => {
    const commands = {
      createProject: vi
        .fn()
        .mockRejectedValue(new ProjectCommandError(code as string)),
      createProjectVersion: vi.fn(),
      archiveProject: vi.fn(),
    };
    await expect(
      new ProjectService({ get: vi.fn() }, commands).create({} as never),
    ).rejects.toBeInstanceOf(exception);
  });

  it('does not disclose operational command failures', async () => {
    const commands = {
      createProject: vi
        .fn()
        .mockRejectedValue(new Error('private.sqlite token=secret')),
      createProjectVersion: vi.fn(),
      archiveProject: vi.fn(),
    };
    await expect(
      new ProjectService({ get: vi.fn() }, commands).create({} as never),
    ).rejects.toMatchObject({ response: { code: 'PROJECT_COMMAND_FAILED' } });
  });

  it('rejects ID mismatch before invoking a command', () => {
    const commands = {
      createProject: vi.fn(),
      createProjectVersion: vi.fn(),
      archiveProject: vi.fn(),
    };
    const service = new ProjectService({ get: vi.fn() }, commands);
    expect(() =>
      service.createVersion('project_001', {
        project: { id: 'project_other' },
      } as never),
    ).toThrow(BadRequestException);
    expect(() =>
      service.archive('project_001', { projectId: 'project_other' } as never),
    ).toThrow(BadRequestException);
    expect(commands.createProjectVersion).not.toHaveBeenCalled();
    expect(commands.archiveProject).not.toHaveBeenCalled();
  });
  it('returns the exact historical snapshot unchanged', async () => {
    const get = vi.fn().mockResolvedValue(snapshot);
    const service = new ProjectService({ get });
    expect(await service.getVersion('project_001', '1')).toBe(snapshot);
    expect(get).toHaveBeenCalledExactlyOnceWith('project_001', 1);
  });

  it.each(['0', '-1', '1.5', '1e2', '1abc', ' 1', '01', '9007199254740992'])(
    'rejects invalid version %s before reading',
    async (version) => {
      const get = vi.fn();
      await expect(
        new ProjectService({ get }).getVersion('project_001', version),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(get).not.toHaveBeenCalled();
    },
  );

  it.each(['ab', 'UPPER', '../db', 'project x', 'a'.repeat(81)])(
    'rejects invalid ID %s',
    async (id) => {
      const get = vi.fn();
      await expect(
        new ProjectService({ get }).getVersion(id, '1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(get).not.toHaveBeenCalled();
    },
  );

  it('returns not found without querying latest', async () => {
    const get = vi.fn().mockResolvedValue(null);
    await expect(
      new ProjectService({ get }).getVersion('project_001', '3'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(get).toHaveBeenCalledExactlyOnceWith('project_001', 3);
  });

  it('sanitizes operational failures without mapping to 404', async () => {
    const get = vi
      .fn()
      .mockRejectedValue(new Error('private.sqlite token=secret'));
    try {
      await new ProjectService({ get }).getVersion('project_001', '1');
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect(
        JSON.stringify((error as InternalServerErrorException).getResponse()),
      ).not.toMatch(/private|secret|sqlite/);
    }
  });
});
