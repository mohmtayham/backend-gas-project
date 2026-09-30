import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { CreateAgentDto, UpdateAgentDto } from './dto/agent.dto';

@Controller('agents')
export class AgentsController {
  constructor(private agents: AgentsService) {}

  @Get()
  list(@Query('q') q?: string, @Query('active') active?: string) {
    return this.agents.list(q, active);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.agents.get(id);
  }

  @Post()
  create(@Body() dto: CreateAgentDto) {
    return this.agents.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAgentDto) {
    return this.agents.update(id, dto);
  }
}
