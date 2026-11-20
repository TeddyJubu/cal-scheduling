import prisma from "@calcom/prisma";
import { CommunityEventRepository } from "./CommunityEventRepository";
import { CommunityEventService } from "./CommunityEventService";

export const communityEventService = new CommunityEventService(new CommunityEventRepository(prisma));
