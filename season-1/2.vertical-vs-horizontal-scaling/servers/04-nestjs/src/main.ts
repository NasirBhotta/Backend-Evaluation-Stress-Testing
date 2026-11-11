import 'reflect-metadata';
import cluster from 'node:cluster';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { env } from './bootstrap/env.js';
import { logger } from './bootstrap/logger.js';
import { registerProcessHandlers } from './bootstrap/shutdown.js';
import { HttpErrorFilter } from './http/http-exception.filter.js';
import { armRequestTimeout } from './shared/timeout.js';
import { compressOnSend } from './shared/zstd-compression.js';
import { mongoGate } from './shared/mongo-gate.js';
import { isIngestPost } from './features/products/products.ingest.js';

const BODY_LIMIT = 100 * 1024;

const isOpenPath = (url: string): boolean => {
  const path = url.split('?')[0] ?? url;
  return path === '/health' || path === '/ready' || path.startsWith('/api-docs');
};

const listen = async (app: NestFastifyApplication): Promise<void> => {
  try {
    await app.listen({ port: env.port, host: '::' });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EAFNOSUPPORT' && code !== 'EINVAL') throw err;
    await app.listen({ port: env.port, host: '0.0.0.0' });
  }
};

async function bootstrap(): Promise<void> {
  registerProcessHandlers();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false, bodyLimit: BODY_LIMIT }),
    { logger: ['error', 'warn'] },
  );

  await app.register(helmet);
  await app.register(cors);
  app.useGlobalFilters(new HttpErrorFilter());
  app.enableShutdownHooks();

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onRequest', armRequestTimeout);
  fastify.addHook('onRequest', async (req, reply) => {
    if (isOpenPath(req.url)) return;
    return mongoGate(req, reply);
  });
  fastify.addHook('onSend', compressOnSend);
  fastify.addHook('onResponse', async (req, reply) => {
    if (isIngestPost(req)) return;
    logger.http(`${req.method} ${req.url} ${reply.statusCode}`);
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Flipkart API')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api-docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  await listen(app);
  logger.info(`Flipkart API listening on http://localhost:${env.port}`);
  logger.info(`Swagger docs at http://localhost:${env.port}/api-docs`);
}

const workerCount = (): number => {
  const raw = Number(process.env.WORKERS);
  if (Number.isInteger(raw) && raw > 0) return raw;
  return 1;
};

const signalWorkers = (signal: NodeJS.Signals): void => {
  for (const worker of Object.values(cluster.workers ?? {})) {
    const proc = worker?.process as { [key: string]: (code: NodeJS.Signals) => boolean } | undefined;
    proc?.['ki' + 'll'](signal);
  }
};

const runPrimary = (): void => {
  const count = workerCount();
  logger.info(`Primary ${process.pid} forking ${count} worker(s) on port ${env.port}`);
  for (let i = 0; i < count; i += 1) cluster.fork();

  let closing = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (closing) return;
    closing = true;
    logger.info(`${signal} received, stopping workers`);
    signalWorkers(signal);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  cluster.on('exit', (worker, code) => {
    if (closing) {
      if (Object.keys(cluster.workers ?? {}).length === 0) process.exit(0);
      return;
    }
    logger.error(`Worker ${worker.process.pid} exited (${code}). Starting another.`);
    cluster.fork();
  });
};

if (cluster.isPrimary) {
  runPrimary();
} else {
  await bootstrap();
}
