import { PartialType } from '@nestjs/swagger';
import { CreateDashboardTemplateDto } from './create-templates.dto';

export class UpdateDashboardTemplateDto extends PartialType(
  CreateDashboardTemplateDto,
) {}