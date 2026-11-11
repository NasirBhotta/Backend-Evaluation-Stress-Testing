import { Controller, Get, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { getMongoTopology } from './bootstrap/mongo-topology.js';
import { redisClient } from './bootstrap/redis.js';

@Controller()
export class HealthController {
  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  ready(@Res({ passthrough: true }) reply: FastifyReply) {
    const topology = getMongoTopology();
    reply.code(topology.reads ? 200 : 503);
    return {
      status: topology.reads ? 'ready' : 'not_ready',
      mongo: topology.connected ? 'connected' : 'disconnected',
      membersUp: `${topology.membersUp}/${topology.membersTotal}`,
      primary: topology.primaryHost,
      writes: topology.writes,
      reads: topology.reads,
      electionPossible: topology.electionPossible,
      redis: redisClient.isReady ? 'up' : 'down',
    };
  }
}
