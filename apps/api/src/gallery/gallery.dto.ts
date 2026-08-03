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

  // Catalogue (album) auquel rattacher le média — vide = hors catalogue.
  @IsOptional()
  @IsString()
  albumId?: string;
}

export class AlbumDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  description?: string;
}
