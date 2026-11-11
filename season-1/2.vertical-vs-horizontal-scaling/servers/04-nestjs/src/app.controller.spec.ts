import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = app.get(HealthController);
  });

  it('GET /health returns ok', () => {
    expect(controller.health()).toEqual({ status: 'ok' });
  });
});
