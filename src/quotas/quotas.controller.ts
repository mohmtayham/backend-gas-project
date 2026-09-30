import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { Lane } from '@prisma/client';
import { QuotasService } from './quotas.service';
import { CreateQuotaDto, UpdateQuotaDto } from './dto/quota.dto';
import { asEnum } from '../common/utils';

@Controller('quotas')
export class QuotasController {
  constructor(private quotas: QuotasService) {}

  @Get()
  list(@Query('agentId') agentId?: string) {
    return this.quotas.list(agentId);
  }

  /** GET /quotas/availability?agentId=..&lane=DOMESTIC&date=2026-10-01 */
  @Get('availability')
  availability(@Query('agentId') agentId: string, @Query('lane') lane: string, @Query('date') date?: string) {
    const fillType = asEnum(Lane, lane, 'lane');
    if (!agentId || !fillType) throw new BadRequestException('agentId and lane are required');
    return this.quotas.availabilityFor(agentId, fillType, date);
  }

  @Post()
  create(@Body() dto: CreateQuotaDto) {
    return this.quotas.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateQuotaDto) {
    return this.quotas.update(id, dto);
  }
}
