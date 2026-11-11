import { ArgumentsHost, Catch, ExceptionFilter, NotFoundException } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { errorHandler } from '../shared/error.js';

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const req = http.getRequest<FastifyRequest>();

    if (exception instanceof NotFoundException) {
      if (!reply.sent) {
        reply.code(404).send({ error: `Route ${req.method} ${req.url} not found` });
      }
      return;
    }

    errorHandler(exception, req, reply);
  }
}
