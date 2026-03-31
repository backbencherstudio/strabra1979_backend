import { ScheduledInspectionStatus } from "prisma/generated/enums";
export type ChartPeriod = 'yearly' | 'monthly' | 'daily';

export class OverviewQueryDto {
  date?: string;
  status?: ScheduledInspectionStatus;
  take?: number;
  chartPeriod?: ChartPeriod;
}
