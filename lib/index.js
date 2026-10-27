/** Recoverable deletion for a single local DSH owner. Files are never removed with a live writer. */
import {
  readdir,
  rm,
  lstat,
  mkdir,
  rename,
  readFile,
  open,
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  resolve,
  join,
  dirname,
  relative,
  isAbsolute,
  basename,
} from "node:path";
import { randomUUID } from "node:crypto";
const PREFIX = "/session-delete";
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const WINDOW = 5000;
export const inject = [
  "webServer",
  "workspaceRegistry",
  "sessions",
  "agents",
  "agentLoop",
];
const fail = (code, message) => ({ ok: false, error: { code, message } });

export function apply(ctx) {
  ctx.effect(() => {
    const root = resolve(home(), "sessions"),
      trash = resolve(home(), "session-delete-trash");
    const registry = ctx.get("workspaceRegistry"),
      agents = ctx.get("agents"),
      sessions = ctx.get("sessions");
    const entries = new Map(),
      handles = new Map(),
      fences = new Set(),
      inFlight = new Set(),
      timers = new Map();
    let chain = Promise.resolve(),
      closing = false;
    const serial = (operation) => {
      const result = chain.then(operation);
      chain = result.catch(() => {});
      return result;
    };
    const log = (error) =>
      ctx.logger?.warn?.(`session-delete: ${String(error)}`);
    const manifest = (e) => join(trash, `${e.token}.json`);
    const payload = (e) => ({
      token: e.token,
      sessionId: e.sessionId,
      expiresAt: e.expiresAt,
      status: e.phase,
      removed: ["pending", "gone"].includes(e.phase),
      restored: e.phase === "restored",
    });
    const save = (e) => atomicJSON(manifest(e), e);
    const snapshot = (id) => ({
      archived: registry.archivedSessionIds.includes(id),
      pinned: registry.pinnedSessionIds.includes(id),
      memberships: registry
        .list()
        .filter((w) => w.sessionIds.includes(id))
        .map((w) => ({
          id: w.id,
          before: w.sessionIds[w.sessionIds.indexOf(id) + 1],
        })),
    });
    async function restoreRegistry(e) {
      for (const member of e.snapshot.memberships) {
        const workspace = registry.get(member.id);
        if (!workspace) continue;
        await workspace.attachSession(e.sessionId);
        if (workspace.insertSessionBefore)
          await workspace.insertSessionBefore(
            e.sessionId,
            workspace.sessionIds.includes(member.before)
              ? member.before
              : undefined,
          );
      }
      if (e.snapshot.archived) await registry.archiveSession(e.sessionId);
      else await registry.unarchiveSession(e.sessionId);
      if (e.snapshot.pinned && !e.snapshot.archived)
        await registry.pinSession(e.sessionId);
      else await registry.unpinSession(e.sessionId);
    }
    async function recoverOriginal(e) {
      // Once restoration begins, never reschedule deletion, even if registry restoration fails.
      e.phase = "restoring";
      await save(e);
      const source = await exists(e.originalPath),
        backup = await exists(e.trashPath);
      if (source && backup)
        throw new Error(
          "Both original and backup exist; manual recovery required",
        );
      if (!source && backup) {
        await mkdir(dirname(e.originalPath), { recursive: true });
        await rename(e.trashPath, e.originalPath);
      }
      if (!(await exists(e.originalPath)))
        throw new Error(
          "Session data unavailable; recovery requires attention",
        );
      await restoreRegistry(e);
      e.phase = "restored";
      await save(e);
      fences.delete(e.sessionId);
    }
    async function purge(e) {
      if (e.phase !== "pending") return;
      if (dirname(e.trashPath) !== trash || basename(e.trashPath) !== e.token)
        throw new Error("Invalid trash path");
      try {
        await rm(e.trashPath, { recursive: true, force: true });
        e.phase = "gone";
        await save(e);
      } catch (error) {
        log(error);
        // A failed cleanup remains pending and retryable; status never claims it is gone.
        if (!closing) schedule(e, 1000);
      }
    }
    function schedule(e, delay = Math.max(0, e.expiresAt - Date.now())) {
      clearTimeout(timers.get(e.token));
      const timer = setTimeout(() => {
        timers.delete(e.token);
        void serial(() => purge(e)).catch(log);
      }, delay);
      timer.unref?.();
      timers.set(e.token, timer);
    }
    const ready = (async () => {
      await mkdir(trash, { recursive: true, mode: 0o700 });
      for (const file of await readdir(trash)) {
        if (!file.endsWith(".json") || !UUID.test(file.slice(0, -5))) continue;
        try {
          const e = JSON.parse(await readFile(join(trash, file), "utf8"));
          const rel = relative(root, e.originalPath);
          if (
            e.token !== file.slice(0, -5) ||
            !ID.test(e.sessionId) ||
            basename(e.originalPath) !== e.sessionId ||
            rel.startsWith("..") ||
            isAbsolute(rel) ||
            rel.split(/[\\/]/).length !== 2 ||
            !Number.isFinite(e.expiresAt) ||
            !e.snapshot ||
            !Array.isArray(e.snapshot.memberships)
          )
            throw new Error("Invalid recovery manifest");
          e.trashPath = join(trash, e.token);
          // Legacy committed manifests had no phase; retain their original deadline.
          e.phase ??= "pending";
          entries.set(e.token, e);
          if (
            ["pending", "prepared", "restoring", "retained"].includes(e.phase)
          )
            fences.add(e.sessionId);
          if (e.phase === "pending") schedule(e);
          else if (["prepared", "restoring", "retained"].includes(e.phase)) {
            try {
              await recoverOriginal(e);
            } catch (error) {
              e.phase = "retained";
              await save(e);
              log(error);
            }
          }
        } catch (error) {
          log(error);
        }
      }
    })();
    // Intercept factory admission before any factory await. Includes in-flight admissions
    // begun before deletion, which deletion drains before checking/releasing a writer.
    let factory;
    try {
      factory = agents.requireFactory?.().target;
    } catch {}
    const wrapped = [];
    if (factory)
      for (const name of ["createAgent", "resume"]) {
        const original = factory[name];
        if (typeof original !== "function") continue;
        const wrapper = function (...args) {
          const options = args[1] ?? {},
            id = options.sessionId ?? options.resumeSessionId;
          if (closing || (id && fences.has(id)))
            return Promise.reject(
              new Error("Session deletion blocks new agent admission"),
            );
          let task;
          task = (async () => {
            await ready;
            if (closing || (id && fences.has(id)))
              throw new Error("Session deletion blocks new agent admission");
            const handle = await Reflect.apply(original, this, args);
            if (handle?.agent && typeof handle.dispose === "function")
              handles.set(handle.agent.session.id, handle);
            return handle;
          })();
          inFlight.add(task);
          void task.finally(() => inFlight.delete(task)).catch(() => {});
          return task;
        };
        factory[name] = wrapper;
        wrapped.push({ name, original, wrapper });
      }
    const offDisposed = ctx.on?.("agent/disposed", ({ agent }) => {
      if (handles.get(agent.session.id)?.agent === agent)
        handles.delete(agent.session.id);
    });
    async function remove(id, operationId) {
      if (operationId && entries.has(operationId)) {
        const prior = entries.get(operationId);
        return prior.sessionId === id
          ? { ok: true, value: payload(prior) }
          : fail(
              "session/conflict",
              "Operation belongs to a different session",
            );
      }
      const existing = [...entries.values()].find(
        (e) =>
          e.sessionId === id &&
          ["pending", "prepared", "restoring", "retained"].includes(e.phase),
      );
      if (existing?.phase === "pending")
        return { ok: true, value: payload(existing) };
      if (existing)
        return fail(
          "session/recovery-required",
          "Prior recovery is incomplete; restart DSH to complete it before deleting again",
        );
      fences.add(id);
      let e,
        journaled = false;
      try {
        await Promise.allSettled([...inFlight]);
        const activity = await ctx.waterfall(
          "workspace/session-activity",
          { sessionId: id },
          () => Promise.resolve([]),
        );
        if (activity.length || agents.get(id)?.status === "running")
          return fail(
            "session/running",
            "Session has active work or reminders",
          );
        const live = sessions.get(id);
        if (live && handles.get(id)?.agent.session !== live)
          return fail(
            "session/in-use",
            "Writer capability unavailable. Restart DSH before opening the session.",
          );
        const originalPath = await locate(root, id);
        if (!originalPath)
          return fail("session/not-found", "Session log not found");
        const token = operationId ?? randomUUID();
        e = {
          version: 2,
          token,
          sessionId: id,
          originalPath,
          trashPath: join(trash, token),
          snapshot: snapshot(id),
          phase: "prepared",
          expiresAt: Date.now() + WINDOW,
        };
        // Journal BEFORE archive or any other mutation. Prepared recovery rolls back.
        await save(e);
        journaled = true;
        entries.set(token, e);
        await registry.archiveSession(id);
        const handle = handles.get(id);
        if (handle && sessions.get(id) === handle.agent.session) {
          await handle.dispose();
          handles.delete(id);
        }
        if (sessions.get(id) || agents.get(id))
          throw new Error("Session writer did not release safely");
        await rename(originalPath, e.trashPath);
        for (const member of e.snapshot.memberships)
          await registry.get(member.id)?.detachSession(id);
        await registry.unpinSession(id);
        e.phase = "pending";
        e.expiresAt = Date.now() + WINDOW;
        await save(e);
        schedule(e);
        return { ok: true, value: payload(e) };
      } catch (error) {
        if (e && journaled) {
          try {
            await recoverOriginal(e);
          } catch (rollback) {
            e.phase = "retained";
            await save(e);
            log(rollback);
            return fail(
              "session/recovery-required",
              "Deletion stopped; data retained for safe recovery",
            );
          }
        }
        throw error;
      } finally {
        if (!journaled || !e || e.phase === "restored") fences.delete(id);
      }
    }
    async function restore(body) {
      const e = entries.get(body.token);
      if (!e || e.sessionId !== body.sessionId)
        return fail("session/undo-expired", "Unknown restore operation");
      if (e.phase === "restored") return { ok: true, value: payload(e) };
      if (e.phase !== "pending" || Date.now() >= e.expiresAt)
        return fail("session/undo-expired", "Restore deadline passed");
      clearTimeout(timers.get(e.token));
      timers.delete(e.token);
      try {
        await recoverOriginal(e);
        return { ok: true, value: payload(e) };
      } catch (error) {
        e.phase = "retained";
        await save(e);
        log(error);
        return fail(
          "session/recovery-required",
          "Restore incomplete; data retained, not permanently deleted",
        );
      }
    }
    function status(body) {
      const e = entries.get(body.token);
      if (!e || e.sessionId !== body.sessionId)
        return {
          ok: true,
          value: {
            status: "unknown",
            sessionId: body.sessionId,
            token: body.token,
          },
        };
      return { ok: true, value: payload(e) };
    }
    const disposeRoute = ctx.webServer.register({
      kind: "prefix",
      path: PREFIX,
      handler(req, res) {
        void (async () => {
          try {
            if (
              !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
                req.socket?.remoteAddress,
              )
            )
              return json(res, 403, fail("forbidden", "Local access only"));
            if (
              req.headers?.origin &&
              ![
                `http://${req.headers.host}`,
                `https://${req.headers.host}`,
              ].includes(req.headers.origin)
            )
              return json(res, 403, fail("forbidden", "Cross-origin request"));
            if (req.method !== "POST")
              return json(res, 405, fail("method-not-allowed", "POST only"));
            const route = new URL(req.url, "http://localhost").pathname.slice(
              PREFIX.length + 1,
            );
            if (!["delete", "restore", "status"].includes(route))
              return json(res, 404, fail("unknown-route", "Unknown route"));
            let body;
            try {
              const chunks = [];
              let size = 0;
              for await (const chunk of req) {
                size += chunk.length;
                if (size > 8192) throw new Error("Body too large");
                chunks.push(chunk);
              }
              body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
              if (
                !body ||
                typeof body.sessionId !== "string" ||
                !ID.test(body.sessionId)
              )
                throw new Error("Invalid sessionId");
              if (
                route !== "delete" &&
                (typeof body.token !== "string" || !UUID.test(body.token))
              )
                throw new Error("Invalid token");
              if (
                body.operationId !== undefined &&
                (typeof body.operationId !== "string" ||
                  !UUID.test(body.operationId))
              )
                throw new Error("Invalid operationId");
            } catch (error) {
              return json(res, 400, fail("malformed-request", error.message));
            }
            await ready;
            const result = await serial(() =>
              route === "delete"
                ? remove(body.sessionId, body.operationId)
                : route === "restore"
                  ? restore(body)
                  : status(body),
            );
            json(res, 200, result);
          } catch (error) {
            json(res, 200, fail("internal", error.message));
          }
        })();
      },
    });
    return async () => {
      closing = true;
      disposeRoute();
      offDisposed?.();
      for (const { name, original, wrapper } of wrapped)
        if (factory[name] === wrapper) factory[name] = original;
      await ready;
      await chain;
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, "session-delete: transactional recovery");
}
async function atomicJSON(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temp, "wx", 0o600);
  try {
    try {
      await handle.writeFile(JSON.stringify(value));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  // Sync the directory entry on POSIX. A failed fsync is surfaced, not ignored.
  const directory = await open(dirname(path), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function locate(root, id) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const project of entries) {
    if (!project.isDirectory() || project.isSymbolicLink()) continue;
    const path = join(root, project.name, id);
    try {
      const info = await lstat(path);
      if (info.isDirectory() && !info.isSymbolicLink()) return path;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
function home() {
  const value = process.env.DSH_HOME?.trim();
  return value
    ? resolve(value.startsWith("~/") ? join(homedir(), value.slice(2)) : value)
    : join(homedir(), ".dsh");
}
function json(res, code, value) {
  const body = JSON.stringify(value);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}
