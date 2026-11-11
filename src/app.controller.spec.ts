import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
    it('opens the operations interface for a browser request', () => {
      const response = { redirect: vi.fn() };
      appController.getHello(
        { headers: { accept: 'text/html' } } as any,
        response as any,
      );
      expect(response.redirect).toHaveBeenCalledWith('/operations');
    });
  });
});
