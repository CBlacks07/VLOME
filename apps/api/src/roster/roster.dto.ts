import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RosterPlayerDto {
  @IsString() @MaxLength(80) name!: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() clubId?: string;
}

export class ClubDto {
  @IsString() @MaxLength(80) name!: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() logoUrl?: string;
}
