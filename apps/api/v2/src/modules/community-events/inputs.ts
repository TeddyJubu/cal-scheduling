import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsTimeZone,
  IsUrl,
  Max,
  Min,
  MinLength,
} from "class-validator";

export class CreateCommunityEventInput {
  @ApiProperty() @IsString() @MinLength(1) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) slug?: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() description?:
    | string
    | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() category?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsUrl() coverImageUrl?: string | null;
  @ApiProperty({ format: "date-time" }) @IsISO8601() startTime!: string;
  @ApiProperty({ format: "date-time" }) @IsISO8601() endTime!: string;
  @ApiProperty() @IsTimeZone() timeZone!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() location?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1 }) @IsOptional() @IsInt() @Min(1) capacity?:
    | number
    | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() hidden?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() showAttendees?: boolean;
}
export class UpdateCommunityEventInput extends PartialType(CreateCommunityEventInput, {
  skipNullProperties: false,
}) {}
export class ListCommunityEventsInput {
  @ApiPropertyOptional({ enum: ["upcoming", "past"] }) @IsOptional() @IsIn(["upcoming", "past"]) period?:
    | "upcoming"
    | "past";
  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) skip?: number;
}
export class CommunityEventRsvpInput {
  @ApiProperty() @IsString() @MinLength(1) name!: string;
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty({ enum: ["GOING", "MAYBE", "NOT_GOING"] }) @IsIn(["GOING", "MAYBE", "NOT_GOING"]) status!:
    | "GOING"
    | "MAYBE"
    | "NOT_GOING";
  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  plusOnes?: number;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() note?: string | null;
}
