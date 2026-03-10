import { Module } from '@nestjs/common';
import { InspectionController } from './inspections.controller';
import { InspectionService } from './inspections.service';

@Module({
  controllers: [InspectionController],
  providers: [InspectionService],
  exports: [InspectionService],
})
export class InspectionModule {}
