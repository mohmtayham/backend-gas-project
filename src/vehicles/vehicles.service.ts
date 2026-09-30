import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVehicleDto, UpdateVehicleDto } from './dto/vehicle.dto';

@Injectable()
export class VehiclesService {
  constructor(private prisma: PrismaService) {}

  list(transporterId?: string, q?: string) {
    return this.prisma.vehicle.findMany({
      where: { transporterId, ...(q ? { plateNo: { contains: q, mode: 'insensitive' } } : {}) },
      include: { transporter: { select: { id: true, name: true } } },
      orderBy: { plateNo: 'asc' },
    });
  }

  get(id: string) {
    return this.prisma.vehicle.findUniqueOrThrow({ where: { id }, include: { transporter: true } });
  }

  create(dto: CreateVehicleDto) {
    return this.prisma.vehicle.create({ data: dto });
  }

  update(id: string, dto: UpdateVehicleDto) {
    return this.prisma.vehicle.update({ where: { id }, data: dto });
  }
}
