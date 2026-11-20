import {
  BOOKING_READ,
  BOOKING_WRITE,
  EVENT_TYPE_READ,
  EVENT_TYPE_WRITE,
  SUCCESS_STATUS,
} from "@calcom/platform-constants";
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CommunityEventsService } from "./community-events.service";
import {
  CommunityEventRsvpInput,
  CreateCommunityEventInput,
  ListCommunityEventsInput,
  UpdateCommunityEventInput,
} from "./inputs";
import {
  CommunityEventOutput,
  CommunityEventRsvpOutput,
  CommunityEventRsvpsOutput,
  CommunityEventsOutput,
} from "./outputs";
import { API_VERSIONS_VALUES } from "@/lib/api-versions";
import { API_KEY_OR_ACCESS_TOKEN_HEADER } from "@/lib/docs/headers";
import { GetUser } from "@/modules/auth/decorators/get-user/get-user.decorator";
import { Permissions } from "@/modules/auth/decorators/permissions/permissions.decorator";
import { ApiAuthGuard } from "@/modules/auth/guards/api-auth/api-auth.guard";
import { PermissionsGuard } from "@/modules/auth/guards/permissions/permissions.guard";

@Controller({ path: "/v2/community-events", version: API_VERSIONS_VALUES })
@UseGuards(ApiAuthGuard, PermissionsGuard)
@ApiTags("Community Events")
@ApiHeader(API_KEY_OR_ACCESS_TOKEN_HEADER)
export class CommunityEventsController {
  constructor(private readonly service: CommunityEventsService) {}
  @Post("/")
  @Permissions([EVENT_TYPE_WRITE])
  @ApiCreatedResponse({ type: CommunityEventOutput })
  async create(@GetUser("id") userId: number, @Body() input: CreateCommunityEventInput) {
    return { status: SUCCESS_STATUS, data: await this.service.create(userId, input) };
  }
  @Get("/")
  @Permissions([EVENT_TYPE_READ])
  @ApiOkResponse({ type: CommunityEventsOutput })
  async list(@GetUser("id") userId: number, @Query() query: ListCommunityEventsInput) {
    return {
      status: SUCCESS_STATUS,
      data: await this.service.execute((domain) => domain.listEvents(userId, query)),
    };
  }
  @Get(":uid")
  @Permissions([EVENT_TYPE_READ])
  @ApiOkResponse({ type: CommunityEventOutput })
  async get(@GetUser("id") userId: number, @Param("uid") uid: string) {
    return {
      status: SUCCESS_STATUS,
      data: await this.service.execute((domain) => domain.getOwnerEvent(userId, uid)),
    };
  }
  @Patch(":uid")
  @Permissions([EVENT_TYPE_WRITE])
  @ApiOkResponse({ type: CommunityEventOutput })
  async update(
    @GetUser("id") userId: number,
    @Param("uid") uid: string,
    @Body() input: UpdateCommunityEventInput
  ) {
    return { status: SUCCESS_STATUS, data: await this.service.update(userId, uid, input) };
  }
  @Post(":uid/cancel")
  @Permissions([EVENT_TYPE_WRITE])
  @ApiCreatedResponse({ type: CommunityEventOutput })
  async cancel(@GetUser("id") userId: number, @Param("uid") uid: string) {
    return {
      status: SUCCESS_STATUS,
      data: await this.service.execute((domain) => domain.cancelEvent(userId, uid)),
    };
  }
  @Get(":uid/rsvps")
  @Permissions([BOOKING_READ])
  @ApiOkResponse({ type: CommunityEventRsvpsOutput })
  async rsvps(@GetUser("id") userId: number, @Param("uid") uid: string) {
    return {
      status: SUCCESS_STATUS,
      data: await this.service.execute((domain) => domain.listRsvps(userId, uid)),
    };
  }
  @Post(":uid/rsvps")
  @Permissions([BOOKING_WRITE])
  @ApiCreatedResponse({ type: CommunityEventRsvpOutput })
  async rsvp(
    @GetUser("id") userId: number,
    @Param("uid") uid: string,
    @Body() input: CommunityEventRsvpInput
  ) {
    return { status: SUCCESS_STATUS, data: await this.service.rsvp(userId, uid, input) };
  }
}
