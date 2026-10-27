# dsh-plugin-session-delete

[English](README.md) · [MIT 许可证](LICENSE)

为 DeepSeek Harness（DSH）Web GUI 的会话行菜单增加 **删除会话**，包含确认弹窗及 **5 秒恢复窗口**。

**0.1.0 为实验版本。** 这是独立插件，不修改 DSH 内置的归档功能。**恢复期限结束后会永久删除日志，请先备份重要对话。**

## 功能

- 会话菜单中的红色「删除会话」操作。
- 展示会话名称、要求勾选确认的弹窗。
- 宿主接受删除后，会话立即从列表移除。
- 右下角提供恢复按钮，连续倒计时进度条使用 DSH 外观主题变量。
- 由宿主执行的 5 秒恢复期限，配合磁盘临时存储、原子恢复日志和重启恢复机制。
- 使用操作 token、状态查询和幂等重试处理删除与恢复。
- 拒绝删除有活动任务的会话，移动日志前安全释放已捕获的空闲 agent 生命周期句柄。

## 安装

[lib](lib/) 中直接提供可读 JavaScript，**无需构建**。当前 manifest 面向 DSH `0.2.1-rc.3` 或更新版本，但未验证每个后续版本的兼容性。

### 桌面版或托管 profile：使用 GUI

打开 **设置 → 插件 → 安装**，输入 GitHub Release 安装包地址：

```text
https://github.com/yinvoke/dsh-plugin-session-delete/releases/latest/download/dsh-plugin-session-delete.tgz
```

该链接仅在 GitHub Release 已上传同名资产后可用。也可以先克隆仓库，再在插件安装界面选择本地克隆目录：

```sh
git clone https://github.com/yinvoke/dsh-plugin-session-delete.git
```

通过 GUI 安装并启用 bundle 后，**完全退出 DSH 并重新打开**。不要使用独立 profile CLI 管理由 Electron 应用托管的 desktop profile。

### CLI 管理的 profile

先停止目标 profile，将 `<profile>` 替换为实际的 CLI 托管 profile 名称：

```sh
dsh plugin --profile <profile> add github:yinvoke/dsh-plugin-session-delete
```

安装依赖并不等于加载插件。还需在该 profile 的 package manifest 中，将 `dsh-plugin-session-delete` **追加**到已有的 `dsh.profile.bundles` 数组，保留原来的条目：

```json
{
  "dsh": {
    "profile": {
      "bundles": ["your-existing-bundle", "dsh-plugin-session-delete"]
    }
  }
}
```

这只是配置片段，不要用它覆盖完整 manifest。随后重启 profile。本地开发时可将 GitHub 安装参数替换为 `add link:<checkout-directory>`，bundle 名称不变。

## 使用

1. 在会话行的 **⋯** 菜单选择 **删除会话**。
2. 勾选确认并提交。
3. 宿主把日志移入临时存储，并移除工作区成员记录。
4. 在右下角 **5 秒内**点击 **恢复**，恢复日志及可恢复的工作区顺序、置顶和归档状态。
5. 期限结束后，宿主永久清理临时日志目录。

实际期限由宿主控制，不取决于动画。刷新页面不会取消删除；如果整个宿主退出，到期临时记录会在插件下次启动时继续处理。清理失败会重试；恢复事务失败会保留数据以便处理，不会静默永久清理。

## 安全与边界

- **仅支持本机单进程使用。** 路由仅接受回环请求，并拒绝外来浏览器 Origin。远程/配对客户端以及多个 DSH 进程共用同一存储不在支持范围。
- **安装或更新后须重启。** 只有插件已捕获生命周期句柄的空闲 agent 才能安全释放。如果会话在插件加载前已处于 live 状态，即使空闲也可能被拒绝；请完全退出并重开 DSH，而非仅刷新页面。
- 进行中的回合、子代理、后台任务或定时提醒可能阻止删除。请先停止相关活动。
- 只清理选中会话自己的日志目录。不会递归清理项目文件、共享附件及独立的子代理/分叉日志。**这不是完整的隐私数据擦除工具。**
- 临时数据位于 `<DSH_HOME>/session-delete-trash`，DSH 默认 home 为 `~/.dsh`。清理后可能保留恢复 manifest；为防止迟到任务重新激活已删除会话，会有意保留 archive ID tombstone。这些属于元数据，不是被删除的对话正文。
- 没有永久回收站，正常恢复期限为 5 秒。存储错误或事务中断可能留下需要人工处理的恢复数据。
- 插件依赖 DSH 生命周期及主题接口，并通过拦截 agent factory 的创建/恢复方法保留 disposal 句柄；DSH 更新可能影响兼容性。

## 开发与验证

本地检查与 CI 使用 Node.js 24：

```sh
node --check lib/index.js
node --check lib/client.js
npm test
```

宿主测试使用临时存储，客户端测试模拟模块加载器及组件接线。**这些测试不是实际运行中 DSH 桌面应用的完整端到端验证。** 请在目标 DSH 版本中用可丢弃会话手动验证，再用于重要对话。

发布与 awesome 列表提交流程见 [发布说明](docs/PUBLISHING.md)。npm 发布是可选项，本次没有 npm 发布计划。

## 卸载

托管 profile 请在 GUI 中禁用或移除插件。CLI 管理的 profile 应先停止运行，从 `dsh.profile.bundles` 移除插件名称，再执行：

```sh
dsh plugin --profile <profile> remove dsh-plugin-session-delete
```

随后重启。卸载前先完成或恢复待删除操作；移除插件会暂停它的清理 worker，直到再次加载。卸载不能恢复已永久清理的对话。

## 许可证

[MIT](LICENSE)，copyright 2026 yinvoke。
