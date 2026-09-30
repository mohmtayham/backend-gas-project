import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { Lane } from '@prisma/client';
import { BaysService } from './bays.service';
import { CreateBayDto, UpdateBayDto } from './dto/bay.dto';
import { asEnum } from '../common/utils';

@Controller('bays')
export class BaysController {
  constructor(private bays: BaysService) {}

  @Get()
  list(@Query('lane') lane?: string) {
    return this.bays.list(asEnum(Lane, lane, 'lane'));
  }

  @Post()
  create(@Body() dto: CreateBayDto) {
    return this.bays.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBayDto) {
    return this.bays.update(id, dto);
  }
}
