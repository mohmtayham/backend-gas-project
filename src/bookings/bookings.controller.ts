import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ActorRole, Lane, TicketStatus } from '@prisma/client';
import { BookingsService } from './bookings.service';
import { CancelBookingDto, CreateBookingDto, UpdateBookingDto } from './dto/booking.dto';
import { asEnum, toInt } from '../common/utils';

@Controller('bookings')
export class BookingsController {
  constructor(private bookings: BookingsService) {}

  @Post()
  create(@Body() dto: CreateBookingDto) {
    return this.bookings.create(dto);
  }

  @Get()
  list(
    @Query('dayId') dayId?: string,
    @Query('lane') lane?: string,
    @Query('status') status?: string,
    @Query('transporterId') transporterId?: string,
    @Query('agentId') agentId?: string,
  ) {
    return this.bookings.list({
      dayId: toInt(dayId, 'dayId'),
      lane: asEnum(Lane, lane, 'lane'),
      status: asEnum(TicketStatus, status, 'status'),
      transporterId,
      agentId,
    });
  }

  /** GET /bookings/mine?actorRole=AGENT&actorId=<agentId> */
  @Get('mine')
  mine(@Query('actorRole') actorRole: string, @Query('actorId') actorId: string) {
    const role = asEnum(ActorRole, actorRole, 'actorRole');
    if (!role || !actorId) throw new BadRequestException('actorRole and actorId are required');
    return this.bookings.mine(role, actorId);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.bookings.get(id);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBookingDto) {
    return this.bookings.update(id, dto);
  }

  @Post(':id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number, @Body() dto: CancelBookingDto) {
    return this.bookings.cancel(id, dto);
  }
}
