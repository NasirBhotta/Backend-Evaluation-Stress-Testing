import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { connectDatabase, disconnectDatabase } from './database.js';
import { connectRedis, disconnectRedis } from './redis.js';
import { logger } from './logger.js';
import { flushIngestOnShutdown } from '../features/products/products.ingest.js';

@Injectable()
export class BootstrapService implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await connectDatabase();
    void connectRedis();
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await flushIngestOnShutdown();
    } catch (err) {
      logger.error(`ingest shutdown flush failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    await Promise.all([disconnectDatabase(), disconnectRedis()]);
  }
}
