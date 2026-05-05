// dto/update-user-role.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { Role } from 'src/common/guard/role/role.enum';

export class UpdateUserRoleDto {
  @ApiProperty({
    description: 'New role to assign to the user',
    enum: Role,
    example: Role.PROPERTY_MANAGER,
  })
  @IsEnum(Role, {
    message:
      'Role must be one of: ADMIN, PROPERTY_MANAGER, AUTHORIZED_VIEWER, OPERATIONAL',
  })
  @IsNotEmpty({ message: 'Role is required' })
  role: Role;
}
