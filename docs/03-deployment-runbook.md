# Sealos 部署与恢复手册

> 本文在实现过程中持续补充实际镜像名、页面位置和验证命令。任何生产变更前先备份授权数据。

## 1. 生产拓扑

- 单个 Sealos `StatefulSet/moonlit-fate-quiz`，固定 1 个实例；容器名也是 `moonlit-fate-quiz`。
- 容器监听 `8787`。
- `/app/data` 挂载至少 1 GiB 的持久化卷，复用当前授权数据卷。
- 就绪探针：`GET /health/ready`。
- 存活探针：`GET /health/live`。
- 公网地址通过 HTTPS 暴露应用端口。

当前生产资源：CPU 限制 `200m`，内存限制 `256Mi`，持久卷 `1Gi`，Sealos 估算约 `0.14`/日。当前 CPU 和内存余量充足，因此不增加资源。实例数固定为 1，关闭缩容到 0 和弹性多副本。SQLite 阶段不能同时运行两个可写实例；需要多实例前必须先迁移到 PostgreSQL 等共享数据库。

探针参数：

| 探针 | 路径 | 首次等待 | 周期 | 超时 | 失败阈值 |
| --- | --- | --- | --- | --- | --- |
| 启动 | `/health/ready` | 5 秒 | 5 秒 | 3 秒 | 24 次 |
| 就绪 | `/health/ready` | 10 秒 | 10 秒 | 3 秒 | 3 次 |
| 存活 | `/health/live` | 20 秒 | 30 秒 | 3 秒 | 3 次 |

## 2. 生产 Secret

以下值必须在 Sealos Secret 或环境变量界面配置，不能提交到 Git：

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD` 或 `ADMIN_PASSWORD_HASH`
- `SESSION_SECRET`
- `LICENSE_TOKEN_SECRET`
- `LEGACY_LICENSE_TOKEN_SECRET`，值沿用旧部署的 `MOONLIT_TOKEN_SECRET`；也可保留旧变量名。
- `CODE_ENCRYPTION_KEY`
- `PUBLIC_BASE_URL`
- `DATA_DIR=/app/data`

`SESSION_SECRET`、`LICENSE_TOKEN_SECRET` 和 `CODE_ENCRYPTION_KEY` 应使用独立的高强度随机值，不能互相复用。

生产值映射：

| 配置 | 值或来源 |
| --- | --- |
| 容器端口 | `8787` |
| 管理员用户名 | 用户指定账号，通过 `ADMIN_USERNAME` 注入 |
| 管理员密码 | 只注入 `ADMIN_PASSWORD_HASH`，不在 Sealos 保存明文密码 |
| 旧授权签名 | 当前部署的 `MOONLIT_TOKEN_SECRET` 原值 |
| 新会话/授权/加密密钥 | 分别生成，不显示在日志和代码中 |
| 公网地址 | `https://vanxwdsqrvsy.sealosbja.site` |

变更 Secret 后的影响：修改管理员密码会让新登录使用新密码；修改 `SESSION_SECRET` 会使后台会话失效；修改 `LICENSE_TOKEN_SECRET` 会使新格式买家令牌失效；修改 `CODE_ENCRYPTION_KEY` 会导致后台无法读取已有密文兑换码。因此后三项必须纳入安全备份，不能随意重建。

## 3. 首次迁移顺序

1. 记录当前镜像、环境变量、卷挂载和公网入口。
2. 从旧容器复制 `/app/data/licenses.json` 作为迁移前备份。
3. 保持原数据卷挂载到 `/app/data`，部署新镜像，但暂不删除旧备份。
4. 检查 `/health/live` 和 `/health/ready`。
5. 使用后台登录，确认测试注册表中存在两套测试。
6. 运行旧 JSON 导入；核对新增、重复和失败数量。
7. 从本地安全位置选择 1000 个明文码清单上传，补全可发放密文。
8. 分别使用一枚测试码验证两套测试。
9. 重启实例，再次验证后台、兑换状态和持久化。

新服务启动时会自动发现 `/app/data/licenses.json` 并幂等导入，不删除旧文件。旧浏览器授权需要同时保留原 `MOONLIT_TOKEN_SECRET`，服务验证成功后会向浏览器签发新格式令牌。

本次迁移实测结果：旧清单 1000 个摘要全部补全明文密文，`added=0`、`completed=1000`、`duplicate=0`、`invalid=0`；旧系统 6 条已兑换状态保留。另有 1 条历史“仅摘要”授权继续保留用于兼容原持有码用户，但不会进入自动发放库存。

## 4. 上线验收地址

- 月下心笺旧入口：`https://vanxwdsqrvsy.sealosbja.site/`
- 月下心笺规范入口：`https://vanxwdsqrvsy.sealosbja.site/tests/moonlit-fate/`
- 内在三声部：`https://vanxwdsqrvsy.sealosbja.site/tests/inner-voices/`
- 超级 SBTI：`https://vanxwdsqrvsy.sealosbja.site/tests/super-sbti/`
- 管理后台：`https://vanxwdsqrvsy.sealosbja.site/admin/`
- 就绪状态：`https://vanxwdsqrvsy.sealosbja.site/health/ready`

## 5. 发布与回滚

只有用户明确表示本地验收通过并允许上传后，才进入本节。日常发布不通过 Sealos 网页手工改镜像，而由 GitHub Actions 使用受限凭据完成。

### 5.1 一次性配置

GitHub 仓库 Actions Secrets 中需要以下四项，只记录名称，不在本文保存值：

| Secret | 用途 |
| --- | --- |
| `SEALOS_KUBECONFIG_B64` | `yuanbao-release` 受限身份的 KubeConfig |
| `PRODUCTION_ADMIN_USERNAME` | 创建备份和验收时登录后台 |
| `PRODUCTION_ADMIN_PASSWORD` | 与上项配套，只由工作流读取 |
| `PRODUCTION_SMOKE_CODE` | 永久保留、不对外发放的超级 SBTI 验收码 |

Sealos 命名空间中存在 `ServiceAccount/Role/RoleBinding` 各一个，名称均为 `yuanbao-release`。Role 只允许读取和更新指定的 `StatefulSet/moonlit-fate-quiz`，以及只读查看 Pod、日志和事件；不允许读取 Secret，不含 `create` 或 `delete`。受限身份已实际验证：目标 StatefulSet 可读取、服务端 dry-run 更新可通过、读取 Secret 返回 `403`。

### 5.2 日常发布

1. AI 运行 `npm run check:release`，五组检查顺序执行，每组最长 5 分钟。
2. AI 检查待提交内容中没有 Secret、数据库和明文兑换码，提交并推送 `main`。
3. `.github/workflows/publish-image.yml` 在 Linux Docker 中再次执行完整检查，发布 `ghcr.io/penguinkingking/moonlit-fate-quiz:<完整提交 SHA>`；纯 Markdown 或 `docs/` 变更不触发它。
4. AI 运行 `npm run release:production -- --approval "正式开放"`。助手核对 `origin/main`，触发 `.github/workflows/release-production.yml` 并等待结果。
5. 工作流最多等待固定 SHA 镜像 5 分钟，然后创建生产数据库备份并确认文件非空。
6. 工作流记录旧镜像，更新 StatefulSet，最多等待 3 分钟。
7. `/health/ready` 必须报告数据库正常且测试数量符合注册表；随后检查根页、后台、所有测试页和引用的 JS/CSS。
8. Chrome 在 390×844 视口执行真实超级 SBTI 流程：兑换、开始、上一题恢复与改选、16 题自动前进、结果页、无横向溢出。
9. 工作流解绑系统专用码，确认令牌失效、兑换门恢复。全部通过才算发布成功。

若普通 Git 推送连续两次出现连接超时或重置，且 `origin/main` 没有被别人更新，使用 `npm run push:github-fallback -- --approval "正式开放"`。该脚本通过 GitHub 官方 Git Data API 上传当前提交；它拒绝脏工作区、拒绝远端父提交变化、拒绝 tree 哈希不一致，也不会 force push。上传成功后会把当前本地分支对齐到 GitHub 生成的等价提交。

生产发布总体上限 15 分钟。正常路径通常远短于上限；上限用于确保外部服务异常时能尽快给出明确失败点。

### 5.3 自动回滚

部署开始后任一步失败，工作流自动把 StatefulSet 切回发布前记录的完整镜像，并最多等待 3 分钟。发布前备份仍会保留。普通代码回滚不恢复数据库；只有确认新版本写入了不兼容数据时，才按第 6 节人工恢复备份。

失败后依次查看 GitHub Actions 中最先失败的步骤、Pod 状态和日志。不要在 GitHub 与 Sealos 两边同时重复点击发布，也不要通过改成 `latest` 绕过失败。

## 6. 数据恢复

1. 暂停管理写操作。
2. 保留损坏数据库副本，不直接覆盖唯一文件。
3. 对候选备份运行 SQLite 完整性检查。
4. 将通过检查的备份恢复为主数据库。
5. 启动应用并检查 `/health/ready`。
6. 核对测试数量、兑换码状态和最近审计日志。
7. 使用测试兑换码完成一次端到端验证。

## 7. 故障判断

- “公网地址准备中”：先检查就绪探针、实例日志和端口，再检查数据库迁移及卷权限。
- 反复重启：检查容器退出码、Secret 是否缺失、数据库是否损坏。
- 后台无法登录：检查管理员变量、系统时间、Cookie Secure 和 HTTPS 转发头。
- 兑换码突然无效：检查测试 slug、数据卷挂载和迁移日志，禁止重新初始化覆盖数据库。
- 发出重复兑换码：立即停止发码，保留数据库和日志，检查事务与唯一索引。

### 已处理：旧数据卷权限导致 CrashLoopBackOff

2026-09-10 首次切换新镜像时，容器日志出现 `SQLITE_CANTOPEN`。根因是旧 Sealos 数据卷中的文件由 root 创建，而应用进程以 UID 1000 运行。生产镜像从 `9fa15f66a04d39beeea13a2b5b5cdd10ee19aa0c` 起，会在启动阶段以 root 身份只修正 `DATA_DIR` 的属主，然后立即降权为 UID/GID 1000 启动服务。修复后 Pod 重建、应用级重启和持久数据复核均通过。

“公网地址准备中”表示网关尚未确认后端实例可用，它是状态而不是独立故障原因。部署、Pod 重建、应用未监听端口或就绪检查失败时都会出现；应结合 Pod 状态、启动日志和 `/health/ready` 判断。页面上的 300/400/500 数字是时间窗口内的 HTTP 分类计数，不能单凭总数断定故障根因。

## 8. 2026-09-10 生产快照

- 镜像：`ghcr.io/penguinkingking/moonlit-fate-quiz:9fa15f66a04d39beeea13a2b5b5cdd10ee19aa0c`。
- 就绪响应：`{"ok":true,"database":true,"schemaVersion":1,"tests":2}`。
- 迁移后手动备份：`platform-2026-09-09T16-24-28-345Z.sqlite`，692224 字节（文件名使用 UTC 时间）。
- 内在三声部兑换码文件：`D:\圆宝大文件\圆宝项目1\测试项目\inner-voices\本地资料\兑换码\内在三声部-兑换码-1000-20260910.txt`。
- 兑换码文件 SHA-256：`BAF422D35A414057F3522878DF8D44684A41D84E07FB3B535A889059A53E00A9`。
- 公网端到端验证：两套测试均完成兑换、令牌验证和解绑回库；浏览器确认内在三声部能进入第 1/48 题。

## 9. 2026-09-10 超级 SBTI 生产快照

- 正式镜像：`ghcr.io/penguinkingking/moonlit-fate-quiz:029e35757fa25faba064a4e9e54e218fa6058841`；GitHub Actions 构建成功。
- 代码提交：`553aac203486da6259338d3705d81a86994a0a8f` 完成目录规整与超级 SBTI；`029e35757fa25faba064a4e9e54e218fa6058841` 修复生产评分脚本组合并补强测试。
- 就绪响应：`{"ok":true,"database":true,"schemaVersion":1,"tests":3}`；`/health/live` 同时返回 `200`。
- 上线前手动备份：`platform-2026-09-09T22-19-42-162Z.sqlite`，692224 字节（文件名使用 UTC 时间）。
- 正式兑换码批次：ID `6`，名称“超级 SBTI 正式批次 2026-09-10”，生成并入库 1000 个。
- 本机清单：`D:\圆宝大文件\圆宝项目1\测试项目\super-sbti\本地资料\兑换码\超级-SBTI-兑换码-1000-20260910.txt`；由 Git 忽略，不进入镜像和仓库。
- 清单 SHA-256：`11bbdb42fb31fa02f557f7604b359b8179dd189232a00f58df1b2333d08daace`；后台批次导出哈希相同且内容逐字节一致。
- 最终库存：月下心笺总数 1006、可用 997、待补全旧码 1、已分配 1、已兑换 7；内在三声部总数 1000、可用 999、已兑换 1；超级 SBTI 总数与可用数均为 1000，其余状态为 0。
- 授权隔离：超级 SBTI 测试码用于另外两套测试均返回 `404`；真实兑换后状态变为已兑换并绑定，验收完成后解绑回到可用，原令牌重新验证返回 `401`。
- 公网流程：完成 16 题自动前进、上一题恢复与改选、隐藏第五选项、`ROOT` 隐藏人格、六维指标、九章解析、说明书、复制和分享回退。
- 长文检查：生产端 13 份人格解析均超过 1000 字，最短为 1262 字；本次 `ROOT` 页面渲染正文 1549 字。
- 响应式验收：1440px 桌面和 390px 手机均无横向溢出或元素越界，页面无脚本错误、控制台错误和失败资源。
- 发布回归：首个 `553aac...` 镜像中的评分辅助函数被 lint 清理误删，根因是测试夹具重复定义同名函数而掩盖了生产脚本依赖；将函数移入 `scoring.js` 并删除测试夹具副本后，重新运行全部检查并发布 `029e357...`。

## 10. 2026-09-10 自动发布验收记录

- 当前生产镜像：`ghcr.io/penguinkingking/moonlit-fate-quiz:169c12d92d95188724505c6281a760e39ae4ba0b`。StatefulSet 与 Pod 镜像一致，实例 `1/1` 就绪，Pod 为 `Running`。
- 镜像构建：GitHub Actions `34478487784` 成功，耗时 1 分 22 秒；镜像使用完整提交 SHA 标签。
- 回滚演练：GitHub Actions `34478735870` 故意把预期测试数设为 `999`。新镜像部署成功后，公网验收按预期失败；工作流在 28 秒内切回旧镜像，回滚步骤和临时凭据清理均成功。演练总耗时 3 分 34 秒，其中 2 分 03 秒是预设的就绪失败等待。
- 正常发布：GitHub Actions `34479252936` 成功，整体 1 分 51 秒；依赖安装 7 秒、备份 3 秒、Sealos 部署与就绪 30 秒、公网浏览器验收 55 秒。
- 正常发布备份：`platform-2026-09-10T12-53-17-894Z.sqlite`，1,011,712 字节。回滚演练备份：`platform-2026-09-10T12-47-57-280Z.sqlite`，1,011,712 字节。
- 公网复核：`/health/ready` 返回数据库正常、schema 版本 1、测试数 3；根页、后台和三套测试入口均返回 `200`。
- 真实浏览器验收：390×844 手机视口完成兑换、开始、第一题返回与改选、16 题自动前进和结果页，无横向溢出；解绑后令牌失效并重新出现兑换门。
- 系统专用验收码最终状态为 `allocated`，保留订单标识且未绑定设备；普通买家库存未被消耗。
- GitHub Secrets 四项均存在；受限 Sealos 身份不能读取 Secret。任何实际凭据和验收码都未写入 Git、日志或本文。
- 本机 Git HTTPS 两次连接失败后，GitHub API 备用路径通过父提交保护与完整 tree 哈希核对完成发布；修复后的备用脚本再次实测成功。
