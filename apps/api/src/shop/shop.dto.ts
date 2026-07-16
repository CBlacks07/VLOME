import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

export class OrderItemDto {
  @IsString() @MaxLength(120) name!: string;
  @IsInt() @Min(0) priceXof!: number;
}

export class CreateOrderDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => OrderItemDto)
  items!: OrderItemDto[];

  @IsString() @MaxLength(40) paymentMethod!: string;
}
