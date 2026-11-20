-- CreateEnum
CREATE TYPE "public"."CommunityEventStatus" AS ENUM ('SCHEDULED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."CommunityEventRsvpStatus" AS ENUM ('GOING', 'MAYBE', 'NOT_GOING');

-- CreateTable
CREATE TABLE "public"."CommunityEvent" (
    "id" SERIAL NOT NULL,
    "uid" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "coverImageUrl" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "timeZone" TEXT NOT NULL,
    "location" TEXT,
    "capacity" INTEGER,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "showAttendees" BOOLEAN NOT NULL DEFAULT true,
    "status" "public"."CommunityEventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CommunityEventRsvp" (
    "id" SERIAL NOT NULL,
    "uid" TEXT NOT NULL,
    "eventId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "public"."CommunityEventRsvpStatus" NOT NULL,
    "plusOnes" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityEventRsvp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommunityEvent_uid_key" ON "public"."CommunityEvent"("uid");

-- CreateIndex
CREATE INDEX "CommunityEvent_userId_startTime_idx" ON "public"."CommunityEvent"("userId", "startTime");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityEvent_userId_slug_key" ON "public"."CommunityEvent"("userId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityEventRsvp_uid_key" ON "public"."CommunityEventRsvp"("uid");

-- CreateIndex
CREATE INDEX "CommunityEventRsvp_eventId_status_idx" ON "public"."CommunityEventRsvp"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityEventRsvp_eventId_email_key" ON "public"."CommunityEventRsvp"("eventId", "email");

-- AddForeignKey
ALTER TABLE "public"."CommunityEvent" ADD CONSTRAINT "CommunityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CommunityEventRsvp" ADD CONSTRAINT "CommunityEventRsvp_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "public"."CommunityEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
