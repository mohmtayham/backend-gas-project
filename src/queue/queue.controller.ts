import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { Lane } from '@prisma/client';
import { QueueService } from './queue.service';
import { asEnum, toInt } from '../common/utils';

@Controller('queue')
export class QueueController {
  constructor(private queue: QueueService) {}

  /** GET /queue/today?lane=DOMESTIC   or   /queue/today?dayId=12 */
  @Get('today')
  today(@Query('lane') lane?: string, @Query('dayId') dayId?: string) {
    return this.queue.board(asEnum(Lane, lane, 'lane'), toInt(dayId, 'dayId'));
  }

  @Get('position/:ticketId')
  position(@Param('ticketId', ParseIntPipe) ticketId: number) {
    return this.queue.position(ticketId);
  }
}
