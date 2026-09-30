import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { TransportersService } from './transporters.service';
import { CreateTransporterDto, UpdateTransporterDto } from './dto/transporter.dto';

@Controller('transporters')
export class TransportersController {
  constructor(private transporters: TransportersService) {}

  @Get()
  list(@Query('q') q?: string, @Query('active') active?: string) {
    return this.transporters.list(q, active);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.transporters.get(id);
  }

  @Post()
  create(@Body() dto: CreateTransporterDto) {
    return this.transporters.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTransporterDto) {
    return this.transporters.update(id, dto);
  }
}
