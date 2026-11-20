import { Module } from "@nestjs/common";
import { CommunityEventsService } from "./CommunityEventsService";
import { CommunityEventsController } from "./community-events.controller";
import { OAuthClientModule } from "@/modules/oauth-clients/oauth-client.module";
import { PrismaModule } from "@/modules/prisma/prisma.module";
import { TokensModule } from "@/modules/tokens/tokens.module";

@Module({
  imports: [PrismaModule, TokensModule, OAuthClientModule],
  controllers: [CommunityEventsController],
  providers: [CommunityEventsService],
})
export class CommunityEventsModule {}
