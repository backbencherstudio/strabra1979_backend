import { Module } from '@nestjs/common';
import { InspectionCriteriaController } from './inspection-criteria.controller';
import { InspectionCriteriaService } from './inspection-criteria.service';

@Module({
  controllers: [InspectionCriteriaController],
  providers: [InspectionCriteriaService],
  exports: [InspectionCriteriaService],
})
export class InspectionCriteriaModule {}