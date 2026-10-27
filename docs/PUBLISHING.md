# Publishing and awesome-list submission

This is a release checklist, not a record of completed network actions. The intended public repository is **https://github.com/yinvoke/dsh-plugin-session-delete** and the license is MIT. Do not claim a release, listing or full runtime verification until it has actually happened.

## Current publication status

- Public repository and `v0.1.0` Release are available; the release asset download was verified.
- CI is provided as `docs/ci-workflow.yml`, not enabled on GitHub: the current OAuth token lacks `workflow` scope. To enable it, copy the template to `.github/workflows/ci.yml` and push using a credential with workflow permissions, or create it in GitHub's web editor.
- The repository was created at 2026-10-27 09:31:48 UTC. Submit the awesome-list PR no earlier than 2026-10-28 09:31:48 UTC (17:31:48 Asia/Singapore).
- Existing catalog entries already cover session deletion/trash. Explain actual differences without claiming uniqueness; acceptance remains the maintainers' decision.

## 1. Prepare the repository

- Confirm the repository is public and owned by `yinvoke`.
- Add the GitHub topic `dsh-plugin`.
- Ensure the package manifest uses `MIT`, points its repository field to this repository, and declares `dsh.bundle.patch` as `./cordis.patch.yml`.
- Preserve the browser declaration and the host/client entry exports. `lib/` is readable executable JavaScript; no transpilation or build is required.
- Keep private profiles, credentials, personal paths and actual session data out of the repository and release.
- Review [中文 README](../README.md), [English README](../README.en.md), [LICENSE](../LICENSE) and [CHANGELOG](../CHANGELOG.md) for agreement with the code.
- Do not run `npm publish` as part of this plan. npm publication is optional and needs its own decision.

## 2. Validate locally

Use Node.js 24 at the repository root:

```sh
node --check lib/index.js
node --check lib/client.js
npm test
npm pack --dry-run --ignore-scripts
```

Check that the package includes the manifest, bundle patch, both JavaScript entry files, license and user documentation. No dependency installation or build script is needed by the current implementation. If the package files allowlist omits optional maintainer docs or the changelog, those remain available in GitHub; ensure essential runtime files are not omitted.

Run a manual test on the intended DSH version with a **disposable** session:

1. Install and enable the bundle, then completely restart DSH.
2. Check the session action, title, acknowledgement and red confirmation button.
3. Confirm deletion removes the row and shows the corner restore notice.
4. Restore inside five seconds; check conversation readability and saved grouping/order/pin/archive state.
5. Delete another disposable session and let the window expire; confirm payload cleanup and no false success on storage errors.
6. Check active tasks are refused and idle captured handles release safely.
7. Check appearance changes, keyboard access and reduced-motion behavior.
8. Test host restart recovery using disposable data only.

Record the exact DSH version and tested platform in release notes. Automated tests simulate parts of the runtime and are not desktop end-to-end coverage. If a check has not been performed, say so rather than treating the checklist as evidence.

## 3. Create a stable release asset

Choose a version and update the package manifest/changelog before tagging. For an initial `0.1.0` release, the intended tag is `v0.1.0`; do not reuse it for different content.

Package without lifecycle scripts and copy the generated tarball to the stable asset name:

```sh
npm pack --ignore-scripts
# Use the actual generated versioned filename if the version has changed.
cp dsh-plugin-session-delete-0.1.0.tgz dsh-plugin-session-delete.tgz
tar -tzf dsh-plugin-session-delete.tgz
```

Create the GitHub Release from the reviewed tag and upload **dsh-plugin-session-delete.tgz**. Keep this filename version-free on every release so the following installation URL continues to resolve:

```text
https://github.com/yinvoke/dsh-plugin-session-delete/releases/latest/download/dsh-plugin-session-delete.tgz
```

For reproducible/pinned installations, provide the corresponding tag-specific URL as well:

```text
https://github.com/yinvoke/dsh-plugin-session-delete/releases/download/v0.1.0/dsh-plugin-session-delete.tgz
```

Verify that the uploaded asset downloads and has the expected contents before announcing it or adding its URL to a public list. Installation should work from the GUI using that URL, or for a CLI-managed profile with:

```sh
dsh plugin --profile <profile> add github:yinvoke/dsh-plugin-session-delete
```

CLI users must explicitly append the package name to `dsh.profile.bundles` after installing. Electron-managed desktop users should use the GUI rather than editing a running managed profile. A local clone can also be installed through the GUI, or with `add link:<checkout-directory>` for CLI-managed profiles.

## 4. Submit to awesome-dsh-plugin later

The contribution rules require the repository to be **at least one day old**. Wait until at least 24 hours after GitHub's repository creation timestamp before opening the listing PR. Age is measured from repository creation, not the first local commit or release time. Preparing the entry now does not make an early PR eligible.

Once the age requirement is met:

- Re-read the upstream contribution rules in case they changed.
- Confirm the public repository contains real code and the required `dsh.bundle` manifest, remains maintained, and has the `dsh-plugin` topic.
- Confirm the release tarball URL works. A `latest/download/` URL must use the stable filename above, not a filename containing a version.
- Copy [awesome-entry.yml](awesome-entry.yml) into the awesome repository as `data/plugins/yinvoke__dsh-plugin-session-delete.yml`.
- Submit **only that entry file**. Do not manually edit generated English/Chinese READMEs or unrelated plugin entries.
- Keep category `session` and the factual bilingual descriptions. No marketing superlatives or unverified capabilities.
- Do not add an `npm:` field. The list discovers npm packages independently if one is published later.
- No icon or screenshots are declared until real GitHub-hosted assets exist. If adding them later, follow the upstream raster-image and screenshot-manifest rules.

Listing CI checks shape, manifest, repository age and formatting. Passing it is not a security audit or a guarantee of acceptance; maintainers also review the source and the accuracy of the description.

## Operational notes to retain in release notes

- Local single-owner process only; remote clients/shared multiprocess storage unsupported.
- Restart required for lifecycle-handle capture. Pre-plugin live writers can be safely refused.
- Temporary payloads and manifests live outside the session corpus in `<DSH_HOME>/session-delete-trash`.
- Expired cleanup resumes next time the plugin starts after host shutdown. Errors can retain data for safe recovery.
- Archive-id tombstones and recovery metadata may remain after payload deletion.
- Child/subagent/fork logs and shared attachments do not cascade with a parent session deletion.
