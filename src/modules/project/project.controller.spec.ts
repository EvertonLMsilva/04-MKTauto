import { Test } from '@nestjs/testing';
import { ProjectController } from './project.controller.js';
import { ProjectService } from './application/project.service.js';

describe('ProjectController', () => {
  it('delegates exact path parameters to the service', async () => {
    const getVersion = vi.fn().mockResolvedValue({ historical: true });
    const module = await Test.createTestingModule({
      controllers: [ProjectController],
      providers: [{ provide: ProjectService, useValue: { getVersion } }],
    }).compile();
    expect(
      await module.get(ProjectController).getVersion('project_001', '1'),
    ).toEqual({ historical: true });
    expect(getVersion).toHaveBeenCalledExactlyOnceWith('project_001', '1');
    await module.close();
  });
});
