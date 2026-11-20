import { SUCCESS_STATUS } from "@calcom/platform-constants";
import type { CommunityEventService } from "@calcom/platform-libraries";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { CreateCommunityEventInput, CommunityEventRsvpInput } from "./inputs";

type OwnerEvent = Awaited<ReturnType<CommunityEventService["getOwnerEvent"]>>;
class CommunityEventData extends CreateCommunityEventInput {
  @ApiProperty() uid!: string;
  @ApiProperty({ enum: ["SCHEDULED", "CANCELLED"] }) status!: string;
  @ApiProperty({ type: Object }) host!: { name: string | null; username: string | null };
  @ApiPropertyOptional() goingCount?: number;
  @ApiPropertyOptional() maybeCount?: number;
  @ApiPropertyOptional({ type: Number, nullable: true }) spotsLeft?: number | null;
  @ApiPropertyOptional({ type: [String] }) attendees?: string[];
}
class CommunityEventRsvpData extends CommunityEventRsvpInput {
  @ApiProperty() uid!: string;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
  @ApiProperty({ format: "date-time" }) updatedAt!: string;
}
export class CommunityEventOutput {
  @ApiProperty({ example: SUCCESS_STATUS }) status!: typeof SUCCESS_STATUS;
  @ApiProperty({ type: CommunityEventData })
  data!: Awaited<ReturnType<CommunityEventService["createEvent"]>>;
}
export class CommunityEventsOutput {
  @ApiProperty({ example: SUCCESS_STATUS }) status!: typeof SUCCESS_STATUS;
  @ApiProperty({
    type: [CommunityEventData],
    description: "Owner events including counts and visibility flags; dates are ISO-8601 strings.",
  })
  data!: OwnerEvent[];
}
export class CommunityEventRsvpsOutput {
  @ApiProperty({ example: SUCCESS_STATUS }) status!: typeof SUCCESS_STATUS;
  @ApiProperty({
    type: [CommunityEventRsvpData],
    description: "Owner-only RSVP records, including emails and ISO-8601 dates.",
  })
  data!: Awaited<ReturnType<CommunityEventService["listRsvps"]>>;
}
export class CommunityEventRsvpOutput {
  @ApiProperty({ example: SUCCESS_STATUS }) status!: typeof SUCCESS_STATUS;
  @ApiProperty({ type: CommunityEventRsvpData }) data!: Awaited<ReturnType<CommunityEventService["rsvp"]>>;
}
