# Sealos 部署与恢复手册

> 本文在实现过程中持续补充实际镜像名、页面位置和验证命令。任何生产变更前先备份授权数据。

## 1. 生产拓扑

- 单个 Sealos 应用，固定 1 个实例。
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
- 管理后台：`https://vanxwdsqrvsy.sealosbja.site/admin/`
- 就绪状态：`https://vanxwdsqrvsy.sealosbja.site/health/ready`

## 5. 发布与回滚

只有用户明确表示本地验收通过并允许上传后，才进入本节。发布前执行完整测试、生成数据库备份，并记录当前镜像摘要。
发布后：等待就绪、检查错误日志、验证三个公网入口。  
回滚时：切回上一镜像；只有数据库迁移不向后兼容时才恢复数据库备份。

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
