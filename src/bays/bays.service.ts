import { Injectable } from '@nestjs/common';
import { Lane } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBayDto, UpdateBayDto } from './dto/bay.dto';

@Injectable()
export class BaysService {
  constructor(private prisma: PrismaService) {}

  list(lane?: Lane) {
    return this.prisma.bayDef.findMany({ where: { lane }, orderBy: { id: 'asc' } });
  }

  create(dto: CreateBayDto) {
    return this.prisma.bayDef.create({ data: dto });
  }

  update(id: number, dto: UpdateBayDto) {
    return this.prisma.bayDef.update({ where: { id }, data: dto });
  }
}
