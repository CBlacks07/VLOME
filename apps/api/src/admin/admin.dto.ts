import { IsIn } from 'class-validator';

export class SetRoleDto {
  @IsIn(['PLAYER', 'ORGANIZER', 'ADMIN'])
  role!: string;
}
