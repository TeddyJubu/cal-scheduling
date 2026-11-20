import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { ApiKeysRepositoryFixture } from "test/fixtures/repository/api-keys.repository.fixture";
import { UserRepositoryFixture } from "test/fixtures/repository/users.repository.fixture";
import { AppModule } from "@/app.module";
import { bootstrap } from "@/bootstrap";

describe("Community Events", () => {
  let app: NestExpressApplication;
  let users: UserRepositoryFixture;
  let ownerId: number;
  let otherId: number;
  let token: string;
  let otherToken: string;
  const base = "/v2/community-events";
  const event = {
    title: "Reading party",
    startTime: new Date(Date.now() + 86400000).toISOString(),
    endTime: new Date(Date.now() + 90000000).toISOString(),
    timeZone: "UTC",
    capacity: 1,
    hidden: true,
    showAttendees: false,
  };
  const rsvp = { name: "Reader One", email: "reader@example.com", status: "GOING" };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    users = new UserRepositoryFixture(module);
    const keys = new ApiKeysRepositoryFixture(module);
    const suffix = `${Date.now()}-${Math.random()}`;
    ownerId = (await users.create({ email: `community-owner-${suffix}@example.com` })).id;
    otherId = (await users.create({ email: `community-other-${suffix}@example.com` })).id;
    token = `cal_test_${(await keys.createApiKey(ownerId, null)).keyString}`;
    otherToken = `cal_test_${(await keys.createApiKey(otherId, null)).keyString}`;
    app = bootstrap(module.createNestApplication<NestExpressApplication>());
    await app.init();
  }, 60000);
  afterAll(async () => {
    if (ownerId) await users.delete(ownerId);
    if (otherId) await users.delete(otherId);
    await app?.close();
  });
  it("validates inputs and handles empty lists", async () => {
    await request(app.getHttpServer()).get(base).expect(401);
    const empty = await request(app.getHttpServer()).get(base).auth(token, { type: "bearer" }).expect(200);
    expect(empty.body).toEqual({ status: "success", data: [] });
    for (const query of ["take=101", "skip=-1", "period=invalid"]) {
      await request(app.getHttpServer()).get(`${base}?${query}`).auth(token, { type: "bearer" }).expect(400);
    }
    await request(app.getHttpServer())
      .post(base)
      .auth(token, { type: "bearer" })
      .send({ ...event, endTime: event.startTime })
      .expect(400);
    await request(app.getHttpServer()).get(`${base}/missing`).auth(token, { type: "bearer" }).expect(404);
  });
  it("creates, lists, updates, RSVPs, enforces capacity and ownership, and cancels", async () => {
    const server = app.getHttpServer();
    const created = await request(server).post(base).auth(token, { type: "bearer" }).send(event).expect(201);
    expect(created.body.status).toBe("success");
    const path = `${base}/${created.body.data.uid}`;
    const list = await request(server)
      .get(`${base}?period=upcoming&take=100&skip=0`)
      .auth(token, { type: "bearer" })
      .expect(200);
    expect(list.body.data).toHaveLength(1);
    const others = await request(server).get(base).auth(otherToken, { type: "bearer" }).expect(200);
    expect(others.body.data).toEqual([]);
    expect(list.body.data[0]).toMatchObject({
      hidden: true,
      showAttendees: false,
      goingCount: 0,
      startTime: event.startTime,
    });
    const past = await request(server).get(`${base}?period=past`).auth(token, { type: "bearer" }).expect(200);
    expect(past.body.data).toEqual([]);
    const skipped = await request(server).get(`${base}?skip=1`).auth(token, { type: "bearer" }).expect(200);
    expect(skipped.body.data).toEqual([]);
    await request(server).get(path).auth(token, { type: "bearer" }).expect(200);
    await request(server).patch(path).auth(token, { type: "bearer" }).send({ startTime: null }).expect(400);
    await request(server)
      .patch(path)
      .auth(token, { type: "bearer" })
      .send({ title: "Updated reading party" })
      .expect(200);
    for (const url of [path, `${path}/rsvps`])
      await request(server).get(url).auth(otherToken, { type: "bearer" }).expect(403);
    await request(server)
      .patch(path)
      .auth(otherToken, { type: "bearer" })
      .send({ title: "Not mine" })
      .expect(403);
    await request(server).post(`${path}/cancel`).auth(otherToken, { type: "bearer" }).expect(403);
    await request(server).post(`${path}/rsvps`).auth(otherToken, { type: "bearer" }).send(rsvp).expect(403);
    const saved = await request(server)
      .post(`${path}/rsvps`)
      .auth(token, { type: "bearer" })
      .send(rsvp)
      .expect(201);
    expect(saved.body.data).toMatchObject({ ...rsvp, plusOnes: 0 });
    await request(server)
      .post(`${path}/rsvps`)
      .auth(token, { type: "bearer" })
      .send({ ...rsvp, name: "Updated reader" })
      .expect(201);
    await request(server)
      .post(`${path}/rsvps`)
      .auth(token, { type: "bearer" })
      .send({ ...rsvp, email: "second@example.com" })
      .expect(409);
    const attendees = await request(server).get(`${path}/rsvps`).auth(token, { type: "bearer" }).expect(200);
    expect(attendees.body.data).toHaveLength(1);
    expect(attendees.body.data[0]).toMatchObject({ email: rsvp.email, name: "Updated reader" });
    expect(attendees.body.data[0].createdAt).toEqual(expect.any(String));
    const owner = await request(server).get(path).auth(token, { type: "bearer" }).expect(200);
    expect(owner.body.data).toMatchObject({
      title: "Updated reading party",
      goingCount: 1,
      maybeCount: 0,
      spotsLeft: 0,
      attendees: [],
      hidden: true,
      showAttendees: false,
    });
    const cancelled = await request(server)
      .post(`${path}/cancel`)
      .auth(token, { type: "bearer" })
      .expect(201);
    expect(cancelled.body.data.status).toBe("CANCELLED");
    await request(server).post(`${path}/rsvps`).auth(token, { type: "bearer" }).send(rsvp).expect(400);
  });
  it("preserves omitted guests on updates and uses them for capacity", async () => {
    const server = app.getHttpServer();
    const created = await request(server)
      .post(base)
      .auth(token, { type: "bearer" })
      .send({ ...event, title: "Guest preservation", capacity: 3 })
      .expect(201);
    const path = `${base}/${created.body.data.uid}/rsvps`;
    const save = (input: object) => request(server).post(path).auth(token, { type: "bearer" }).send(input);
    expect((await save({ ...rsvp, plusOnes: 2 }).expect(201)).body.data.plusOnes).toBe(2);
    expect((await save(rsvp).expect(201)).body.data.plusOnes).toBe(2);
    await save({ ...rsvp, email: "second@example.com" }).expect(409);
    expect((await save({ ...rsvp, status: "MAYBE" }).expect(201)).body.data.plusOnes).toBe(2);
    expect((await save({ ...rsvp, email: "second@example.com" }).expect(201)).body.data.plusOnes).toBe(0);
    await save(rsvp).expect(409);
    expect((await save({ ...rsvp, plusOnes: 0 }).expect(201)).body.data.plusOnes).toBe(0);
  });
});
