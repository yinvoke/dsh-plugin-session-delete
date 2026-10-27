window.__ModuleLoader__.load({
  id: "dsh-plugin-session-delete",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require("react");
    const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = "session-delete";

    const zh = {
      "menu.delete": "删除会话",
      "dialog.title": "删除此会话？",
      "dialog.description":
        "会话将立即移出列表。5 秒内可恢复，超时后永久清理对话记录。",
      "dialog.scope": "不会删除项目文件或其他会话。",
      "dialog.unnamed": "未命名会话",
      "dialog.acknowledge": "我确认删除这条会话",
      "dialog.cancel": "取消",
      "dialog.confirm": "删除会话",
      "notice.deleted": "会话已删除",
      "notice.restored": "会话已恢复",
      "notice.restoring": "恢复中…",
      "notice.restore": "恢复 · {seconds}s",
      "notice.close": "关闭",
      "dialog.deleting": "正在删除…",
      "error.transport": "无法连接宿主进程，删除未执行。",
      "error.notFound":
        "找不到这个会话的日志（可能已经被清理）。刷新列表后应会消失。",
      "error.inUse":
        "该会话由旧版插件加载，暂时无法安全释放。请完全退出并重新打开 DSH 后再删除。",
      "error.running": "该会话仍有运行中的任务或定时提醒，请先停止相关任务。",
      "error.expired": "恢复时间已结束，会话已永久删除。",
      "error.internal": "删除失败：{message}",
    };

    const en = {
      "menu.delete": "Delete session",
      "dialog.title": "Delete this session?",
      "dialog.description":
        "The session is removed immediately. Restore it within 5 seconds before its conversation is permanently erased.",
      "dialog.scope": "Project files and other sessions will not be deleted.",
      "dialog.unnamed": "Untitled session",
      "dialog.acknowledge": "I confirm deleting this session",
      "dialog.cancel": "Cancel",
      "dialog.confirm": "Delete session",
      "notice.deleted": "Session deleted",
      "notice.restored": "Session restored",
      "notice.restoring": "Restoring…",
      "notice.restore": "Restore · {seconds}s",
      "notice.close": "Close",
      "dialog.deleting": "Deleting…",
      "error.transport":
        "Could not reach the host process; nothing was deleted.",
      "error.notFound":
        "No log found for this session (it may already be gone). It should disappear after a list refresh.",
      "error.inUse":
        "This session is still in use (open or retained). Open another session or reload the page, then try again.",
      "error.running":
        "This session has active work or scheduled reminders. Stop them before deleting.",
      "error.expired":
        "The restore window has ended. The session was permanently deleted.",
      "error.internal": "Delete failed: {message}",
    };

    /** One pending deletion request shared by the menu row and the overlay dialog. */
    function createDeletionStore() {
      let state = { pending: null, notice: null };
      const listeners = new Set();
      const emit = () => {
        for (const listener of [...listeners]) listener();
      };
      return {
        getSnapshot: () => state,
        notice: (notice) => {
          state = { ...state, notice };
          emit();
        },
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        request: (sessionId, title) => {
          state = {
            ...state,
            pending: {
              sessionId,
              title: typeof title === "string" ? title : "",
            },
          };
          emit();
        },
        settle: () => {
          state = { ...state, pending: null };
          emit();
        },
      };
    }

    /**
     * POST one JSON payload to this package's host route and decode the envelope.
     * The path is document-relative because the GUI is served with `<base href="./">`.
     */
    async function post(path, payload) {
      let response;
      try {
        response = await fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch {
        return {
          ok: false,
          error: { code: "transport", message: "host route unavailable" },
        };
      }
      try {
        const envelope = await response.json();
        if (
          typeof envelope === "object" &&
          envelope !== null &&
          envelope.ok === true
        ) {
          return { ok: true, value: envelope.value };
        }
        const error =
          typeof envelope === "object" && envelope !== null
            ? envelope.error
            : undefined;
        return {
          ok: false,
          error:
            typeof error === "object" && error !== null
              ? error
              : { code: "internal", message: `HTTP ${response.status}` },
        };
      } catch {
        return {
          ok: false,
          error: { code: "internal", message: `HTTP ${response.status}` },
        };
      }
    }

    /** Map one failure envelope onto localized copy. */
    function errorCopy(t, error) {
      const message = typeof error?.message === "string" ? error.message : "";
      switch (error?.code) {
        case "session/undo-expired":
          return t("error.expired");
        case "session/not-found":
          return t("error.notFound");
        case "session/in-use":
          return t("error.inUse");
        case "session/running":
          return t("error.running");
        case "transport":
          return t("error.transport");
        default:
          return t("error.internal", {
            message: message === "" ? "unknown error" : message,
          });
      }
    }

    /** Menu row: raise the confirmation request and close the row menu. */
    function DeleteSessionMenuItem(props) {
      const {
        sessionId,
        displayTitle,
        useMenuOpenState,
        requestDelete,
        usePendingDeletion,
        t,
      } = props;
      const locked = usePendingDeletion((state) => state.notice !== null);
      const [, setMenuOpen] = useMenuOpenState();
      return h(
        primitives.MenuItemButton,
        {
          danger: true,
          disabled: locked,
          separatorBefore: true,
          icon: h(primitives.IconTrashOutlineRegular, { size: 14 }),
          onSelect: () => {
            setMenuOpen(false);
            requestDelete(sessionId, displayTitle);
          },
        },
        t("menu.delete"),
      );
    }

    /** The `shell.overlay` entry: nothing while no deletion is pending. */
    function DeleteSessionDialog({
      usePendingDeletion,
      settleDeletion,
      performDelete,
      restoreDeletion,
      clearNotice,
      t,
    }) {
      const state = usePendingDeletion((state) => state);
      return h(
        React.Fragment,
        null,
        state.pending &&
          h(DeleteSessionConfirm, {
            key: state.pending.sessionId,
            request: state.pending,
            settleDeletion,
            performDelete,
            t,
          }),
        state.notice &&
          h(UndoDeletionNotice, {
            key: state.notice.token,
            request: state.notice,
            restoreDeletion,
            clearNotice,
            t,
          }),
      );
    }

    function UndoDeletionNotice({ request, restoreDeletion, clearNotice, t }) {
      const [animationDelay] = React.useState(
        () =>
          -Math.min(5000, Math.max(0, 5000 - (request.expiresAt - Date.now()))),
      );
      const [seconds, setSeconds] = React.useState(
        Math.max(0, Math.ceil((request.expiresAt - Date.now()) / 1000)),
      );
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(null);
      const [restored, setRestored] = React.useState(false);
      React.useEffect(() => {
        const tick = () =>
          setSeconds(
            Math.max(0, Math.ceil((request.expiresAt - Date.now()) / 1000)),
          );
        const timer = setInterval(tick, 100);
        return () => clearInterval(timer);
      }, [request.expiresAt]);
      React.useEffect(() => {
        if ((!restored && seconds > 0) || busy || error) return;
        const timer = setTimeout(clearNotice, restored ? 1800 : 800);
        return () => clearTimeout(timer);
      }, [seconds, restored, busy, error]);
      const restore = async () => {
        if (busy || seconds <= 0) return;
        setBusy(true);
        const result = await restoreDeletion(request);
        setBusy(false);
        if (result.ok) setRestored(true);
        else setError(result.error);
      };
      return h(
        "div",
        {
          role: error ? "alert" : "status",
          className: "sd-notice",
          style: {
            position: "fixed",
            bottom: 20,
            right: 20,
            zIndex: 10000,
            width: 320,
            maxWidth: "calc(100vw - 40px)",
            boxSizing: "border-box",
            padding: "14px 16px",
            background: "var(--dsw-alias-bg-layer-2)",
            color: "var(--dsw-alias-label-primary)",
            borderRadius: "var(--dsw-radius-lg, 12px)",
            border: "none",
            fontFamily: "var(--dsw-font-family, inherit)",
            boxShadow: "0 4px 18px oklch(0.15 0.005 260 / 0.10)",
          },
        },
        h(
          "div",
          {
            style: {
              display: "flex",
              gap: 16,
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 13,
            },
          },
          h(
            "span",
            {
              style: {
                display: "flex",
                alignItems: "center",
                gap: 10,
                lineHeight: 1.5,
                fontWeight: 500,
              },
            },
            h(primitives.IconTrashOutlineRegular, { size: 16 }),
            error
              ? errorCopy(t, error)
              : restored
                ? t("notice.restored")
                : t("notice.deleted"),
          ),
          !restored &&
            seconds > 0 &&
            !error &&
            h(
              "button",
              {
                type: "button",
                disabled: busy,
                onClick: restore,
                className: "sd-restore",
                style: { whiteSpace: "nowrap" },
              },
              busy ? t("notice.restoring") : t("notice.restore", { seconds }),
            ),
          error &&
            h(
              "button",
              { type: "button", onClick: clearNotice },
              t("notice.close"),
            ),
        ),
        !restored &&
          !error &&
          h(
            "div",
            {
              "aria-hidden": true,
              style: {
                height: 2,
                marginTop: 14,
                background: "var(--dsw-alias-border-l2)",
                borderRadius: 2,
                overflow: "hidden",
              },
            },
            h("div", {
              className: "sd-countdown",
              style: {
                height: "100%",
                width: "100%",
                background: "var(--dsw-alias-label-tertiary)",
                transformOrigin: "left",
                animationDelay: `${animationDelay}ms`,
              },
            }),
          ),
      );
    }

    /** One request's confirmation form; in-flight and error state die with it. */
    function DeleteSessionConfirm({
      request,
      settleDeletion,
      performDelete,
      t,
    }) {
      const [acknowledged, setAcknowledged] = React.useState(false);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(null);

      const close = () => {
        if (busy) return;
        settleDeletion();
      };

      const confirm = async () => {
        if (busy || !acknowledged) return;
        setBusy(true);
        setError(null);
        const result = await performDelete(request.sessionId);
        setBusy(false);
        if (result.ok) {
          settleDeletion();
          return;
        }
        setError(result.error);
      };

      const name = request.title.trim() || t("dialog.unnamed");
      const danger = "var(--session-delete-danger, oklch(0.56 0.19 27))";
      return h(
        primitives.Modal,
        {
          open: true,
          className: "session-delete-modal",
          title: t("dialog.title"),
          closeLabel: t("dialog.cancel"),
          onClose: close,
          footer: h(
            "div",
            {
              style: {
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                width: "100%",
              },
            },
            h(
              "button",
              {
                type: "button",
                className: "sd-action sd-cancel",
                disabled: busy,
                onClick: close,
              },
              t("dialog.cancel"),
            ),
            h(
              "button",
              {
                type: "button",
                className: "sd-action sd-danger",
                disabled: busy || !acknowledged,
                onClick: () => {
                  void confirm();
                },
              },
              busy ? t("dialog.deleting") : t("dialog.confirm"),
            ),
          ),
        },
        h(
          "div",
          {
            "aria-busy": busy,
            style: { display: "grid", gap: 18, maxWidth: 420 },
          },
          h(
            "div",
            {
              className: "sd-target",
              style: {
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                minWidth: 0,
              },
            },
            h(
              "span",
              { className: "sd-target-icon", "aria-hidden": true },
              h(primitives.IconTrashOutlineRegular, { size: 18 }),
            ),
            h(
              "strong",
              {
                style: {
                  fontSize: 15,
                  lineHeight: 1.5,
                  overflowWrap: "anywhere",
                  maxHeight: "6em",
                  overflowY: "auto",
                },
              },
              name,
            ),
          ),
          h(
            "div",
            {
              style: {
                display: "grid",
                gap: 8,
                fontSize: 14,
                lineHeight: 1.65,
              },
            },
            h(
              "p",
              { style: { margin: 0, opacity: 0.7, fontSize: 13 } },
              t("dialog.scope"),
            ),
          ),
          h(
            "label",
            {
              className: "sd-acknowledge",
              style: {
                display: "flex",
                gap: 9,
                alignItems: "center",
                fontSize: 13,
                cursor: busy ? "default" : "pointer",
                paddingBlock: 12,
              },
            },
            h("input", {
              type: "checkbox",
              checked: acknowledged,
              disabled: busy,
              "data-modal-autofocus": true,
              style: { width: 16, height: 16, margin: 0, accentColor: danger },
              onChange: (event) => setAcknowledged(event.currentTarget.checked),
            }),
            t("dialog.acknowledge"),
          ),
          error !== null &&
            h(
              "p",
              {
                role: "alert",
                style: {
                  margin: 0,
                  color: danger,
                  fontSize: 13,
                  lineHeight: 1.6,
                  overflowWrap: "anywhere",
                },
              },
              errorCopy(t, error),
            ),
        ),
      );
    }

    /**
     * Client plugin body: one session-row menu entry plus its confirmation
     * overlay. The menu row only raises a request; the destructive call runs
     * from the overlay, so it survives the row menu unmounting.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      ctx.effect(
        () => ctx.locale.register(NS, { zh, en }),
        "session-delete: dictionaries",
      );
      ctx.effect(() => {
        if (typeof document === "undefined") return () => {};
        const style = document.createElement("style");
        style.textContent = `
.sd-notice .sd-restore { background: transparent; color: var(--dsw-alias-label-primary); border: none; border-radius: var(--dsw-radius-sm, 6px); padding: 6px 10px; font: inherit; font-weight: 550; cursor: pointer; }
.sd-notice .sd-restore:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-active); }
.sd-notice button:focus-visible { outline: 2px solid var(--dsw-focus-ring-color); outline-offset: 3px; }
.sd-notice button:disabled { opacity: .5; cursor: wait; }
.sd-countdown { animation: sd-countdown-shrink 5000ms linear both; }
@keyframes sd-countdown-shrink { from { transform: scaleX(1); } to { transform: scaleX(0); } }
@media (prefers-reduced-motion: reduce) { .sd-countdown { animation: none; transform: scaleX(0); } }
.session-delete-modal { width: min(440px, calc(100vw - 32px)) !important; }
.session-delete-modal .sd-target { padding-block: 2px 6px; }
.session-delete-modal .sd-target-icon { flex: 0 0 34px; height: 34px; display: grid; place-items: center; border-radius: 10px; color: oklch(0.56 0.19 27); background: oklch(0.56 0.19 27 / 0.09); }
.session-delete-modal .sd-target strong { padding-top: 5px; }
.session-delete-modal .sd-acknowledge { border-top: 1px solid oklch(0.55 0.008 260 / 0.18); }
.session-delete-modal .sd-action { min-width: 88px; min-height: 36px; padding: 8px 16px; border-radius: 8px; font: inherit; font-size: 13px; font-weight: 550; cursor: pointer; transition: background-color 150ms ease-out, opacity 150ms ease-out; }
.session-delete-modal .sd-cancel { background: transparent; color: inherit; border: 1px solid oklch(0.55 0.008 260 / 0.3); }
.session-delete-modal .sd-cancel:hover { background: oklch(0.55 0.008 260 / 0.09); }
.session-delete-modal .sd-danger { background: oklch(0.56 0.19 27); color: oklch(0.98 0.005 27); border: 1px solid transparent; }
.session-delete-modal .sd-danger:hover:not(:disabled) { background: oklch(0.50 0.18 27); }
.session-delete-modal .sd-action:disabled { opacity: 0.45; cursor: not-allowed; }
.session-delete-modal .sd-action:focus-visible, .session-delete-modal input:focus-visible { outline: 2px solid oklch(0.62 0.16 27); outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) { .session-delete-modal .sd-action { transition: none; } }
`;
        document.head.appendChild(style);
        return () => style.remove();
      }, "session-delete: dialog styles");

      ctx.inject(["slots", "sessions", "uiWorkspace"], (scope) => {
        const store = createDeletionStore();

        const requestDelete = (sessionId, title) => {
          if (store.getSnapshot().notice) return;
          store.request(sessionId, title);
        };

        const performDelete = async (sessionId) => {
          const operationId = crypto.randomUUID();
          let result = await post("session-delete/delete", {
            sessionId,
            operationId,
          });
          if (!result.ok && result.error?.code === "transport") {
            result = await post("session-delete/status", {
              sessionId,
              token: operationId,
            });
            if (result.ok && result.value.status !== "pending") {
              return {
                ok: false,
                error: {
                  code:
                    result.value.status === "gone"
                      ? "session/undo-expired"
                      : "transport",
                  message: "Deletion outcome could not be confirmed",
                },
              };
            }
          }
          if (result.ok) {
            if (scope.uiWorkspace.mainReference?.sessionId === sessionId)
              scope.uiWorkspace.clearMain();
            store.notice({ ...result.value, sessionId });
            store.settle();
            try {
              await scope.sessions.refresh();
            } catch {
              /* host is authoritative */
            }
          }
          return result;
        };
        const restoreDeletion = async (request) => {
          const result = await post("session-delete/restore", {
            token: request.token,
            sessionId: request.sessionId,
          });
          if (result.ok) {
            try {
              await scope.sessions.refresh();
            } catch {}
          }
          return result;
        };

        scope.slots.inject("sidebar.workspaces.session.menu.item", () => {
          try {
            return scope.slots.register(
              {
                name: "sidebar.workspaces.session.menu.item",
                id: "session-delete",
                order: 460,
                locale: NS,
                inject: () => ({
                  requestDelete,
                  hooks: { pendingDeletion: store },
                }),
              },
              DeleteSessionMenuItem,
            );
          } catch {
            return () => {};
          }
        });

        scope.slots.inject("shell.overlay", () => {
          try {
            return scope.slots.register(
              {
                name: "shell.overlay",
                id: "session-delete-dialog",
                locale: NS,
                inject: () => ({
                  hooks: { pendingDeletion: store },
                  settleDeletion: store.settle,
                  clearNotice: () => store.notice(null),
                  restoreDeletion,
                  performDelete,
                }),
              },
              DeleteSessionDialog,
            );
          } catch {
            return () => {};
          }
        });
      });
    }

    exports.inject = ["locale", "slots", "sessions", "uiWorkspace"];
    exports.apply = apply;
    return module.exports;
  },
});
