# dsh-plugin-session-delete

[简体中文](README.zh.md) · [MIT license](LICENSE)

Add **Delete session** to the DeepSeek Harness (DSH) Web GUI's session-row menu, with a confirmation dialog and a five-second restore window.

**Experimental 0.1.0.** This is an independent plugin, not a change to DSH's built-in archive feature. **Deletion is destructive after the restore deadline. Back up important conversations first.**

## Features

- A red Delete session action in the sidebar's session menu.
- Confirmation with the session title and an explicit acknowledgement.
- Immediate removal from the session list after the host accepts deletion.
- A bottom-right restore notice with a continuous countdown indicator, using DSH appearance tokens.
- A host-owned five-second restore deadline, with temporary on-disk storage, atomic recovery journals and restart recovery.
- Operation tokens, status lookup and idempotent retries for deletion/restoration.
- Refusal to remove sessions with active work, and safe release of captured idle agent handles before moving their logs.

## Install

The package ships readable JavaScript in [lib](lib/). It has **no build step**. The current manifest targets DSH `0.2.1-rc.3` or newer; compatibility with every newer release has not been verified.

### Desktop or managed profiles: use the GUI

Open **Settings → Plugins → Install** and enter the release tarball URL:

```text
https://github.com/yinvoke/dsh-plugin-session-delete/releases/latest/download/dsh-plugin-session-delete.tgz
```

This URL becomes usable once a GitHub Release includes that asset. Alternatively, clone the repository and choose the local checkout directory in the plugin installer:

```sh
git clone https://github.com/yinvoke/dsh-plugin-session-delete.git
```

Let the GUI install and enable the bundle. **Completely quit and reopen DSH** afterward. Do not manage an Electron-owned desktop profile through the standalone profile CLI.

### CLI-managed profiles

Stop the target profile before changing it. Replace `<profile>` with a CLI-managed profile name:

```sh
dsh plugin --profile <profile> add github:yinvoke/dsh-plugin-session-delete
```

Installing a dependency is not enough: explicitly append `dsh-plugin-session-delete` to the existing `dsh.profile.bundles` array in that profile's package manifest. Preserve all existing entries:

```json
{
  "dsh": {
    "profile": {
      "bundles": ["your-existing-bundle", "dsh-plugin-session-delete"]
    }
  }
}
```

The example is a fragment, not a replacement for the complete profile manifest. Restart the profile. For a local development checkout, use `add link:<checkout-directory>` instead of the GitHub specification and register the same bundle name.

## Use

1. Open a session row's **⋯** menu and select **Delete session**.
2. Check the acknowledgement and confirm.
3. The host moves the log directory to temporary storage and removes workspace membership.
4. Use **Restore** in the bottom-right notice within five seconds to recover the session and its saved workspace order, pin and archive state where possible.
5. After the deadline, the host permanently removes the temporary log directory.

The deadline is enforced by the host, not the animation. Reloading the page does not cancel deletion. If the entire host exits, expired temporary entries are handled when the plugin next starts. A failed cleanup is retried; a failed restoration retains data for recovery rather than silently purging it.

## Safety and limits

- The client supports **one deletion/restore window at a time**. Finish the current operation before deleting another session.
- Runtime development has been on macOS in a single-process setup; other platforms and full desktop end-to-end behavior are not verified.
- **Local, single-process use only.** Routes accept loopback requests and reject foreign browser origins. Remote/paired clients and multiple DSH processes sharing the same storage are not supported.
- **Restart after installing/updating.** Idle agents can be released only when this plugin captured their lifecycle handle. A session already live before the plugin loaded may be refused even when idle. Fully restart DSH, not just the page.
- Active turns, subagents, background jobs and scheduled reminders can block deletion. Stop the relevant activity first.
- Only the selected session's log directory is removed. Project files, shared attachments, and separate child/subagent/fork logs are **not** recursively deleted. This is not a complete privacy-erasure tool.
- Temporary payloads live under `<DSH_HOME>/session-delete-trash` (DSH's default home is `~/.dsh`). Recovery manifests may remain after cleanup. Archive-id tombstones are intentionally retained to prevent late admission of deleted sessions; these are metadata, not retained conversation payloads.
- No permanent recycle bin is provided. The normal restore window is five seconds. Storage failures or interrupted transactions can leave retained recovery data requiring attention.
- The plugin relies on DSH lifecycle and theme interfaces, including intercepting agent-factory creation/resume to retain disposal handles. DSH upgrades can affect compatibility.

## Development and verification

Use Node.js 24 for the local checks and CI:

```sh
node --check lib/index.js
node --check lib/client.js
npm test
```

The host tests use temporary storage; the client tests simulate the module loader and component wiring. They are **not** full end-to-end validation in a running DSH desktop application. Review behavior in your target DSH release, using a disposable session, before relying on deletion of important data.

Release packaging and the awesome-list submission checklist are in [Publishing](docs/PUBLISHING.md). npm publication is optional and is not part of the current release plan.

## Uninstall

Use the managed profile's GUI to disable/remove the plugin. For CLI-managed profiles, stop the profile, remove the bundle name from `dsh.profile.bundles`, then run:

```sh
dsh plugin --profile <profile> remove dsh-plugin-session-delete
```

Restart DSH. Before uninstalling, finish or restore pending deletions: removing the plugin also stops its cleanup worker until it is loaded again. Uninstalling does not restore already purged conversations.

## License

[MIT](LICENSE), copyright 2026 yinvoke.
