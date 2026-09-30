import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './audit.service';
import { toInt } from '../common/utils';

@Controller('audit')
export class AuditController {
  constructor(private audit: AuditService) {}

  @Get()
  list(
    @Query('entity') entity?: string,
    @Query('entityId') entityId?: string,
    @Query('action') action?: string,
    @Query('limit') limit?: string,
  ) {
    return this.audit.list({ entity, entityId, action, limit: toInt(limit, 'limit') });
  }
}
