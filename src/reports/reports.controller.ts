import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { Lane } from '@prisma/client';
import { ReportsService } from './reports.service';
import { asEnum, toInt } from '../common/utils';

@Controller('reports')
export class ReportsController {
  constructor(private reports: ReportsService) {}

  @Get('daily')
  daily(@Query('dayId') dayId: string) {
    const id = toInt(dayId, 'dayId');
    if (!id) throw new BadRequestException('dayId is required');
    return this.reports.daily(id);
  }

  @Get('agent/:id')
  agent(@Param('id') id: string, @Query('date') date?: string) {
    return this.reports.agent(id, date);
  }

  @Get('quota')
  quota(@Query('lane') lane: string, @Query('date') date?: string) {
    const l = asEnum(Lane, lane, 'lane');
    if (!l) throw new BadRequestException('lane is required');
    return this.reports.quota(l, date);
  }
}
