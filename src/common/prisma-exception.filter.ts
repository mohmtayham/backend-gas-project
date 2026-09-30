import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Prisma } from '@prisma/client';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(e: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const map: Record<string, [number, string, string]> = {
      P2002: [409, 'DUPLICATE', 'A record with the same unique value already exists'],
      P2025: [404, 'NOT_FOUND', 'Record not found'],
      P2003: [400, 'INVALID_REFERENCE', 'A related record does not exist'],
    };
    const [status, code, message] = map[e.code] ?? [500, 'DB_ERROR', e.message];
    res.status(status).json({ code, message, details: e.meta });
  }
}
