import { Module } from '@nestjs/common';
import { BootstrapService } from './bootstrap.service.js';

@Module({
  providers: [BootstrapService],
})
export class BootstrapModule {}
