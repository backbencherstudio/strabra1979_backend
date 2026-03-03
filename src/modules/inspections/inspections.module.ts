import { Module } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { InspectionController } from './inspections.controller';
import { InspectionService } from './inspections.service';

@Module({
  controllers: [InspectionController],
  providers: [InspectionService],
  exports: [InspectionService],
})
export class InspectionModule {}
