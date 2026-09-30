import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { DayStatus, Lane } from '@prisma/client';
import { DaysService } from './days.service';
import { RolloverService } from './rollover.service';
import { CloseDayDto, CreateDayDto, ExtendBookingDto, OpenBookingDto, PauseDto, ReopenDto } from './dto/day.dto';
import { asEnum } from '../common/utils';

@Controller('days')
export class DaysController {
  constructor(private days: DaysService, private rollover: RolloverService) {}

  @Get()
  list(@Query('lane') lane?: string, @Query('status') status?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.days.list({ lane: asEnum(Lane, lane, 'lane'), status: asEnum(DayStatus, status, 'status'), from, to });
  }

  @Get('today')
  today(@Query('lane') lane?: string) {
    return this.days.today(asEnum(Lane, lane, 'lane'));
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.days.get(id);
  }

  /** Create (or return) the queue day for a date + lane. */
  @Post()
  ensure(@Body() dto: CreateDayDto) {
    return this.days.ensure(dto);
  }

  @Post(':id/open-booking')
  openBooking(@Param('id', ParseIntPipe) id: number, @Body() dto: OpenBookingDto) {
    return this.days.openBooking(id, dto);
  }

  @Post(':id/extend-booking')
  extendBooking(@Param('id', ParseIntPipe) id: number, @Body() dto: ExtendBookingDto) {
    return this.days.extendBooking(id, dto);
  }

  @Post(':id/close-booking')
  closeBooking(@Param('id', ParseIntPipe) id: number, @Body('actor') actor?: string) {
    return this.days.closeBooking(id, actor);
  }

  @Post(':id/reopen')
  reopen(@Param('id', ParseIntPipe) id: number, @Body() dto: ReopenDto) {
    return this.days.reopen(id, dto);
  }

  @Post(':id/pause-line')
  pause(@Param('id', ParseIntPipe) id: number, @Body() dto: PauseDto) {
    return this.days.pauseLine(id, dto);
  }

  @Post(':id/resume-line')
  resume(@Param('id', ParseIntPipe) id: number, @Body('actor') actor?: string) {
    return this.days.resumeLine(id, actor);
  }

  /** Close-day wizard, step 1: preview what will be carried / cancelled. */
  @Get(':id/close-preview')
  closePreview(@Param('id', ParseIntPipe) id: number) {
    return this.rollover.preview(id);
  }

  /** Close-day wizard, step 2: apply the plan. */
  @Post(':id/close')
  close(@Param('id', ParseIntPipe) id: number, @Body() dto: CloseDayDto) {
    return this.rollover.close(id, dto);
  }
}
