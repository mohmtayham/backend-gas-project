import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { LinkStatus } from '@prisma/client';
import { LinksService } from './links.service';
import { CreateLinkDto, UpdateLinkDto } from './dto/link.dto';
import { asEnum } from '../common/utils';

@Controller('links')
export class LinksController {
  constructor(private links: LinksService) {}

  @Get()
  list(
    @Query('agentId') agentId?: string,
    @Query('transporterId') transporterId?: string,
    @Query('status') status?: string,
  ) {
    return this.links.list({ agentId, transporterId, status: asEnum(LinkStatus, status, 'status') });
  }

  @Post()
  create(@Body() dto: CreateLinkDto) {
    return this.links.create(dto);
  }

  /** Approve / revoke: { "status": "APPROVED" } */
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLinkDto) {
    return this.links.update(id, dto);
  }
}
