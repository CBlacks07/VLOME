import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class SetRoleDto {
  @IsIn(['PLAYER', 'ORGANIZER', 'ADMIN'])
  role!: string;
}

export class NewsDto {
  @IsString()
  @MinLength(3)
  @MaxLength(140)
  title!: string;

  @IsString()
  @MaxLength(40)
  category!: string;

  @IsString()
  @MaxLength(8000)
  body!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  published?: boolean;
}

export class NewsUpdateDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(140)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  body?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  published?: boolean;
}

export class ProductDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsString()
  @MaxLength(40)
  category!: string;

  @IsInt()
  @Min(0)
  priceXof!: number;

  @IsInt()
  @Min(0)
  stock!: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  imageUrl?: string;
}

export class ProductUpdateDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  category?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceXof?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  imageUrl?: string;
}

export class OrderStatusDto {
  @IsIn(['pending', 'paid', 'delivered', 'cancelled'])
  status!: string;
}
