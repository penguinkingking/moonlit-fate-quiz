# Windows 11 Docker Desktop 快速恢复

> 适用范围：本机 Docker Desktop 在镜像构建前无法启动，日志出现 `Docker/run/*.sock`、`dockerInference`、`sailor-ingest.sock`、`file cannot be accessed` 或 AF_UNIX socket 相关错误。

## 已确认现象

2026-09-07 的成功修复中，Docker Desktop 因遗留 `dockerInference` socket 无法启动。停止 Docker、执行 `wsl --shutdown`，再把 `%LOCALAPPDATA%\Docker\run` 和相关运行目录改名保存后，Docker 自动重建目录并恢复；已有镜像、卷和容器未丢失。

2026-09-09 的日志再次出现同类问题，目标变为 `sailor-ingest.sock`。这属于 Docker Desktop 启动环境故障，不是项目 `Dockerfile` 或网页代码构建失败。

## 发布前判断

1. 先运行 `docker info`。能返回 Server 信息时，不做任何恢复操作。
2. 如果只提示找不到 `dockerDesktopLinuxEngine` 管道，确认 Docker Desktop 是否正在启动。
3. 若启动日志命中上述 socket 错误，再使用下面的已知恢复流程。
4. 没有相同日志证据时，不套用本流程，应先重新诊断。

## 已知恢复流程

以下步骤由 AI 执行，用户不需要手工操作：

1. 记录 Docker Desktop、Engine、WSL 和 Windows 版本。
2. 正常退出 Docker Desktop，并确认 `com.docker.backend` 等进程已停止。
3. 执行 `wsl --shutdown`。
4. 不直接删除损坏的 socket；把 `%LOCALAPPDATA%\Docker\run` 改名为带时间戳的 `.afunix-stale-*` 目录。
5. 只有日志同时指向 `%LOCALAPPDATA%\docker-secrets-engine` 时，才同样改名该目录。
6. 启动 Docker Desktop，等待 `docker info` 同时返回 Client 和 Server。
7. 检查原有镜像、数据卷和容器仍然存在，再进行项目镜像构建。

运行目录只是 Docker Desktop 的临时 socket 状态；改名而不是删除，可以保留故障现场并允许 Docker 重建。不得把 Docker 数据目录、WSL 数据盘或项目数据卷作为本流程的目标。

## 版本策略

- 使用当前稳定版 Docker Desktop，但不把“升级”当成这个问题的唯一修复。
- 升级后仍需执行 `docker info` 和实际镜像构建验证。
- 不执行 Factory Reset，不卸载 Docker，不清理镜像或数据卷来解决单纯的 socket 启动问题。
- 快速恢复一次后仍失败，停止继续处理本机 Docker，保留日志并改用 GitHub Actions 的 Linux Docker 构建。

## 镜像构建策略

- 日常页面开发：直接运行本地平台构建，不需要 Docker。
- 用户批准上线后：本机 Docker 健康时可做镜像验证。
- 正式发布：默认由 GitHub Actions 构建并推送 GHCR，Sealos 拉取固定镜像摘要。
