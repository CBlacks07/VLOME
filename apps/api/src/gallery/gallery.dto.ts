import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class GalleryItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(140)
  title!: string;

  @IsString()
  @MaxLength(300)
  mediaUrl!: string;

  @IsOptional()
  @IsIn(['image', 'video'])
  mediaType?: string;

  @IsOptional()
  @IsString()
  tournamentId?: string;
}
