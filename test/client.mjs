/**
 * Smoke test for the browser half: loads the module-loader bundle against a
 * fake `window.__ModuleLoader__`, then checks the two slot registrations.
 *
 *   node test/client.mjs
 */

import assert from "node:assert/strict";

const registrations = [];
const injectedFaces = [];

const React = {
  createElement: (type, props, ...children) => ({
    type,
    props: {
      ...(props ?? {}),
      ...(children.length === 0
        ? {}
        : { children: children.length === 1 ? children[0] : children }),
    },
  }),
  useState: (value) => [value, () => {}],
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
};

const primitives = {
  MenuItemButton: function MenuItemButton() {},
  IconTrashOutlineRegular: function IconTrashOutlineRegular() {},
  RiskConfirmation: function RiskConfirmation() {},
  Modal: function Modal() {},
  Button: function Button() {},
};

let loaded;
globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory }) {
      loaded = {
        id,
        exports: factory((name) => {
          if (name === "react") return React;
          if (name === "@deepseek-ai/dsh-client-ui-primitives")
            return primitives;
          throw new Error(`unexpected require: ${name}`);
        }),
      };
    },
  },
};

await import("../lib/client.js");

assert.equal(
  loaded.id,
  "dsh-plugin-session-delete",
  "bundle id matches the package name",
);
assert.equal(typeof loaded.exports.apply, "function", "exports apply()");

const dictionaries = [];
const ctx = {
  effect(run) {
    run();
    return () => {};
  },
  locale: {
    register(namespace, dicts) {
      dictionaries.push({ namespace, dicts });
      return () => {};
    },
  },
  inject(deps, callback) {
    assert.deepEqual(deps, ["slots", "sessions", "uiWorkspace"]);
    return callback(scope);
  },
};

const slotInjections = [];
const scope = {
  uiWorkspace: {
    mainReference: { sessionId: "session-undo" },
    clearMain() {
      this.mainReference = undefined;
    },
  },
  slots: {
    inject(name, callback) {
      slotInjections.push(name);
      return callback();
    },
    register(options, component) {
      registrations.push({ options, component });
      return () => {};
    },
  },
  sessions: {
    async refresh() {},
  },
};

loaded.exports.apply(ctx);

assert.deepEqual(
  dictionaries.map((entry) => entry.namespace),
  ["session-delete"],
);
assert.deepEqual(
  Object.keys(dictionaries[0].dicts).sort(),
  ["en", "zh"],
  "both dictionaries registered",
);

assert.deepEqual(slotInjections, [
  "sidebar.workspaces.session.menu.item",
  "shell.overlay",
]);
assert.equal(registrations.length, 2);

const menu = registrations.find(
  (entry) => entry.options.name === "sidebar.workspaces.session.menu.item",
);
assert.equal(menu.options.id, "session-delete");
assert.equal(menu.options.order, 460);
assert.equal(menu.options.locale, "session-delete");
const menuFace = menu.options.inject();
assert.equal(typeof menuFace.requestDelete, "function");

const overlay = registrations.find(
  (entry) => entry.options.name === "shell.overlay",
);
assert.equal(overlay.options.id, "session-delete-dialog");
const overlayFace = overlay.options.inject();
assert.equal(typeof overlayFace.hooks.pendingDeletion.getSnapshot, "function");
assert.equal(typeof overlayFace.hooks.pendingDeletion.subscribe, "function");
assert.ok(
  loaded.exports.inject.includes("locale"),
  "locale is an explicit activation dependency",
);
assert.equal(typeof overlayFace.performDelete, "function");
assert.equal(typeof overlayFace.settleDeletion, "function");

// The request store round-trips through the injected hooks.
const source = overlayFace.hooks.pendingDeletion;
// Match the real renderer: hooks entries are observable sources, not React hooks.
const pendingHook = (select) =>
  select(React.useSyncExternalStore(source.subscribe, source.getSnapshot));
let notifications = 0;
const unsubscribe = source.subscribe(() => notifications++);
assert.equal(
  pendingHook((state) => state.pending),
  null,
);
menuFace.requestDelete("session-1", "Draft");
assert.deepEqual(
  pendingHook((state) => state.pending),
  { sessionId: "session-1", title: "Draft" },
);

// The menu row renders the primitives entry, closes the menu, and raises the request.
{
  const opened = [];
  const closed = [];
  const requested = [];
  const element = menu.component({
    sessionId: "session-1",
    displayTitle: "Draft",
    useMenuOpenState: () => [true, (value) => closed.push(value)],
    requestDelete: (id, title) => requested.push([id, title]),
    usePendingDeletion: pendingHook,
    t: (key) => dictionaries[0].dicts.zh[key] ?? key,
  });
  assert.equal(element.type, primitives.MenuItemButton);
  assert.equal(element.props.danger, true);
  assert.equal(element.props.separatorBefore, true);
  assert.equal(element.props.children, "删除会话");
  element.props.onSelect();
  assert.deepEqual(closed, [false]);
  assert.deepEqual(requested, [["session-1", "Draft"]]);
}

// The overlay renders one risk confirmation per pending request.
{
  const element = overlay.component({
    usePendingDeletion: pendingHook,
    settleDeletion: overlayFace.settleDeletion,
    performDelete: overlayFace.performDelete,
    t: (key) => key,
  });
  const confirmation = element.props.children[0];
  assert.equal(
    typeof confirmation.type,
    "function",
    "confirmation form mounts for the pending request",
  );
  const dialog = confirmation.type(confirmation.props);
  assert.equal(dialog.type, primitives.Modal);
  const footer = dialog.props.footer;
  assert.equal(
    footer.props.children[1].props.disabled,
    true,
    "destructive action requires acknowledgement",
  );
  assert.equal(
    dialog.props.children.props.children[0].props.children[1].props.children,
    "Draft",
    "target title has its own row",
  );
}

overlayFace.settleDeletion();
assert.equal(
  pendingHook((state) => state.pending),
  null,
);

assert.equal(
  notifications,
  2,
  "request and settlement notify the overlay subscriber",
);
menuFace.requestDelete("session-undo", "Undo test");
let requests = 0;
globalThis.fetch = async (path, init) => {
  requests++;
  if (path.endsWith("/restore")) {
    assert.equal(JSON.parse(init.body).token, "test-token");
    return { json: async () => ({ ok: true, value: { restored: true } }) };
  }
  return {
    json: async () => ({
      ok: true,
      value: { token: "test-token", expiresAt: Date.now() + 5000 },
    }),
  };
};
const deleted = await overlayFace.performDelete("session-undo");
assert.equal(deleted.ok, true);
assert.equal(requests, 1, "deletion is requested immediately");
assert.equal(
  scope.uiWorkspace.mainReference,
  undefined,
  "deleting selected session clears its retained main view",
);
menuFace.requestDelete("session-second", "Second");
assert.equal(
  source.getSnapshot().pending,
  null,
  "second deletion cannot replace an active recovery window",
);
assert.equal(source.getSnapshot().pending, null, "confirmation closes");
assert.equal(
  source.getSnapshot().notice.token,
  "test-token",
  "restore notice retains server token",
);
// The non-modal restore notice is anchored away from the main work area.
const effects = [];
React.useEffect = (effect) => effects.push(effect);
const cornerTree = overlay.component({
  usePendingDeletion: pendingHook,
  settleDeletion: overlayFace.settleDeletion,
  performDelete: overlayFace.performDelete,
  restoreDeletion: overlayFace.restoreDeletion,
  clearNotice: overlayFace.clearNotice,
  t: (key) => key,
});
const noticeElement = cornerTree.props.children[1];
const notice = noticeElement.type(noticeElement.props);
assert.equal(notice.props.style.right, 20);
assert.equal(notice.props.style.bottom, 20);
assert.equal(notice.props.style.left, undefined);
assert.equal(notice.props.role, "status");
assert.equal(
  notice.props.style.background,
  "var(--dsw-alias-bg-layer-2)",
  "notice follows app appearance",
);
const progress = notice.props.children[1].props.children;
assert.equal(
  progress.props.className,
  "sd-countdown",
  "progress uses continuous CSS animation",
);
assert.equal(
  progress.props.style.transform,
  undefined,
  "whole-second updates do not step the progress transform",
);
const restored = await overlayFace.restoreDeletion(source.getSnapshot().notice);
assert.equal(restored.ok, true);
assert.equal(requests, 2, "restore uses host endpoint");
overlayFace.clearNotice();
assert.equal(source.getSnapshot().notice, null);
unsubscribe();
console.log(
  "ok — localized menu and observable confirmation overlay pass regression checks",
);
