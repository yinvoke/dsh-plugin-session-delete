/** Host regression tests use only a temporary DSH_HOME, never real user data. */
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  lstat,
  rm,
  readdir,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { apply } from "../lib/index.js";

const home = await mkdtemp(join(tmpdir(), "dsh-session-delete-"));
const previousHome = process.env.DSH_HOME;
process.env.DSH_HOME = home;
const project = join(home, "sessions", "--test--");
const id = "session-test";
const path = join(project, id);
const live = new Map(),
  activeAgents = new Map();
let activity = [],
  detachFails = false,
  attachFails = false,
  closed = 0,
  resumeGate,
  resumeEntered;
const listeners = new Map();
const workspace = {
  id: "workspace-test",
  sessionIds: [id, "session-neighbor"],
  async detachSession(value) {
    if (detachFails) throw new Error("detach failed");
    this.sessionIds = this.sessionIds.filter((x) => x !== value);
  },
  async attachSession(value) {
    if (!this.sessionIds.includes(value)) this.sessionIds.unshift(value);
    if (attachFails) throw new Error("attach failed after write");
  },
  async insertSessionBefore(value, before) {
    this.sessionIds = this.sessionIds.filter((x) => x !== value);
    const at = this.sessionIds.indexOf(before);
    this.sessionIds.splice(at < 0 ? this.sessionIds.length : at, 0, value);
  },
};
const registry = {
  archivedSessionIds: [],
  pinnedSessionIds: [id],
  list: () => [workspace],
  get: (value) => (value === workspace.id ? workspace : undefined),
  async archiveSession(value) {
    if (activity.length) throw new Error("active work");
    if (!this.archivedSessionIds.includes(value))
      this.archivedSessionIds.push(value);
    this.pinnedSessionIds = this.pinnedSessionIds.filter((x) => x !== value);
  },
  async unarchiveSession(value) {
    this.archivedSessionIds = this.archivedSessionIds.filter(
      (x) => x !== value,
    );
  },
  async unpinSession(value) {
    this.pinnedSessionIds = this.pinnedSessionIds.filter((x) => x !== value);
  },
  async pinSession(value) {
    this.pinnedSessionIds.push(value);
  },
};
const factory = {
  async resume() {
    resumeEntered?.();
    if (resumeGate) await resumeGate;
    const session = { id };
    const agent = { session, status: "idle" };
    live.set(id, session);
    activeAgents.set(id, agent);
    return {
      agent,
      async dispose() {
        closed++;
        live.delete(id);
        activeAgents.delete(id);
      },
    };
  },
};
const services = {
  workspaceRegistry: registry,
  sessions: { get: (value) => live.get(value) },
  agents: {
    get: (value) => activeAgents.get(value),
    requireFactory: () => ({ target: factory }),
  },
};
let handler, dispose;
const ctx = {
  effect(run) {
    dispose = run();
  },
  get: (name) => services[name],
  waterfall: async () => activity,
  on(name, fn) {
    listeners.set(name, fn);
    return () => listeners.delete(name);
  },
  webServer: {
    register(route) {
      handler = route.handler;
      return () => {};
    },
  },
};
function mount() {
  apply(ctx);
}
async function call(body = { sessionId: id }, route = "delete", options = {}) {
  return new Promise((resolve) => {
    const req = {
      method: options.method ?? "POST",
      url: `/session-delete/${route}`,
      headers: {},
      socket: { remoteAddress: options.address ?? "127.0.0.1" },
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(
          typeof body === "string" ? body : JSON.stringify(body),
        );
      },
    };
    let status;
    handler(req, {
      writeHead(value) {
        status = value;
      },
      end(value) {
        resolve({ status, ...JSON.parse(value) });
      },
    });
  });
}
async function seed() {
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "session.v4.jsonl.zstd"), "test data");
  workspace.sessionIds = [id, "session-neighbor"];
  registry.archivedSessionIds = [];
  registry.pinnedSessionIds = [id];
}
async function missing(value) {
  await assert.rejects(lstat(value), { code: "ENOENT" });
}
try {
  mount();
  await seed();
  // Active work is refused independently of a cached idle session.
  activity = [{ kind: "job" }];
  assert.equal((await call()).error.code, "session/running");
  await lstat(path);
  activity = [];
  // Pre-plugin live writers have no supported release capability: fail closed.
  live.set(id, { id });
  assert.equal((await call()).error.code, "session/in-use");
  await lstat(path);
  live.clear();
  // Captured idle writer is disposed through its public handle, not private map removal.
  await factory.resume();
  const [deleted, concurrent] = await Promise.all([call(), call()]);
  assert.equal(deleted.ok, true);
  assert.equal(
    concurrent.value.token,
    deleted.value.token,
    "concurrent deletion is idempotent",
  );
  assert.equal(closed, 1);
  assert.equal(live.has(id), false);
  assert.equal(deleted.value.expiresAt > Date.now(), true);
  await missing(path);
  assert.equal(workspace.sessionIds.includes(id), false);
  const trashPath = join(home, "session-delete-trash", deleted.value.token);
  await lstat(trashPath);
  // Duplicate requests share the same undo token/deadline.
  assert.equal((await call()).value.token, deleted.value.token);
  assert.equal(
    (
      await call(
        { sessionId: id, token: "00000000-0000-0000-0000-000000000000" },
        "restore",
      )
    ).error.code,
    "session/undo-expired",
  );
  const restored = await call(
    { sessionId: id, token: deleted.value.token },
    "restore",
  );
  assert.equal(restored.ok, true);
  await lstat(path);
  await missing(trashPath);
  assert.deepEqual(workspace.sessionIds, [id, "session-neighbor"]);
  assert.equal(registry.pinnedSessionIds.includes(id), true);
  assert.equal(registry.archivedSessionIds.includes(id), false);
  // Registry failure rolls back file move and membership state.
  detachFails = true;
  assert.equal((await call()).ok, false);
  await lstat(path);
  assert.equal(registry.pinnedSessionIds.includes(id), true);
  detachFails = false;
  // Actual host timer enforces five seconds without a browser.
  const expired = await call();
  await missing(path);
  await wait(5150);
  await missing(join(home, "session-delete-trash", expired.value.token));
  assert.equal(
    (await call({ sessionId: id, token: expired.value.token }, "restore")).error
      .code,
    "session/undo-expired",
  );
  // Validation and local-only guards.
  for (const sessionId of ["../etc", "a/b", "", "session ok"])
    assert.equal((await call({ sessionId })).status, 400);
  assert.equal((await call({}, "other")).status, 404);
  assert.equal((await call({}, "delete", { method: "GET" })).status, 405);
  assert.equal((await call({}, "delete", { address: "10.1.2.3" })).status, 403);
  assert.equal((await call("{oops")).status, 400);
  assert.equal(
    (await call({ sessionId: "session-missing" })).error.code,
    "session/not-found",
  );
  // Different sessions have independent tokens; cleanup recovers after reload.
  await seed();
  const recover = await call();
  await dispose();
  mount();
  const undoAfterReload = await call(
    { sessionId: id, token: recover.value.token },
    "restore",
  );
  assert.equal(undoAfterReload.ok, true);
  await lstat(path);
  await dispose();
  const receipts = await readdir(join(home, "session-delete-trash"));
  assert.equal(
    receipts.every((file) => file.endsWith(".json")),
    true,
    "only idempotency receipts remain",
  );
  mount();
  // Client-generated operation id survives lost response/retry and restart.
  await seed();
  const operationId = "11111111-1111-4111-8111-111111111111";
  const op = await call({ sessionId: id, operationId });
  assert.equal(op.value.token, operationId);
  assert.equal(
    (await call({ sessionId: id, token: operationId }, "status")).value.status,
    "pending",
  );
  await assert.rejects(
    factory.resume({}, { resumeSessionId: id }),
    /deletion blocks/,
  );
  const opUndo = await call({ sessionId: id, token: operationId }, "restore");
  assert.equal(opUndo.ok, true);
  assert.equal(
    (await call({ sessionId: id, operationId })).value.status,
    "restored",
    "retry never deletes again",
  );
  assert.equal(
    (
      await call(
        { sessionId: id, token: "22222222-2222-4222-8222-222222222222" },
        "status",
      )
    ).value.status,
    "unknown",
  );
  // Delete drains a factory operation already past admission, then closes its writer.
  let release, entered;
  resumeGate = new Promise((resolve) => {
    release = resolve;
  });
  const entryReached = new Promise((resolve) => {
    entered = resolve;
  });
  resumeEntered = entered;
  const opening = factory.resume({}, { resumeSessionId: id });
  await entryReached;
  const duringOpening = call();
  await wait(20);
  release();
  await opening;
  const afterOpening = await duringOpening;
  assert.equal(afterOpening.ok, true);
  assert.equal(live.has(id), false, "in-flight writer closed before moving");
  resumeGate = undefined;
  resumeEntered = undefined;
  await call({ sessionId: id, token: afterOpening.value.token }, "restore");
  // Failed partial registry restore retains original data and never schedules purge.
  const partial = await call();
  attachFails = true;
  assert.equal(
    (await call({ sessionId: id, token: partial.value.token }, "restore")).error
      .code,
    "session/recovery-required",
  );
  await lstat(path);
  assert.equal(
    (await call({ sessionId: id, token: partial.value.token }, "status")).value
      .status,
    "retained",
  );
  attachFails = false;
  await dispose();
  mount();
  assert.equal(
    (await call({ sessionId: id, token: partial.value.token }, "status")).value
      .status,
    "restored",
    "restart completes retained restoration",
  );
  // Simulate interrupted prepared journal after directory move. Startup rolls back rather than deleting.
  await dispose();
  const crashToken = "33333333-3333-4333-8333-333333333333";
  const crashTrash = join(home, "session-delete-trash", crashToken);
  const { rename } = await import("node:fs/promises");
  await rename(path, crashTrash);
  await writeFile(
    join(home, "session-delete-trash", crashToken + ".json"),
    JSON.stringify({
      token: crashToken,
      sessionId: id,
      originalPath: path,
      phase: "prepared",
      expiresAt: Date.now() - 100,
      snapshot: {
        archived: false,
        pinned: true,
        memberships: [{ id: workspace.id, before: "session-neighbor" }],
      },
    }),
  );
  mount();
  assert.equal(
    (await call({ sessionId: id, token: crashToken }, "status")).value.status,
    "restored",
  );
  await lstat(path);
  await missing(crashTrash);
  await dispose();
  console.log(
    "ok — host undo, idle handle release, active guards, rollback, five-second expiry and restart recovery",
  );
} finally {
  await dispose?.();
  if (previousHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previousHome;
  // Verified exact mkdtemp-owned test root; no user data is touched.
  assert.equal(home.startsWith(join(tmpdir(), "dsh-session-delete-")), true);
  await rm(home, { recursive: true, force: true });
}
