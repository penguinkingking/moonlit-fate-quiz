# Sealos 部署与恢复手册

> 本文在实现过程中持续补充实际镜像名、页面位置和验证命令。任何生产变更前先备份授权数据。

## 1. 生产拓扑

- 单个 Sealos 应用，固定 1 个实例。
- 容器监听 `8787`。
- `/app/data` 挂载至少 1 GiB 的持久化卷，复用当前授权数据卷。
- 就绪探针：`GET /health/ready`。
- 存活探针：`GET /health/live`。
- 公网地址通过 HTTPS 暴露应用端口。

建议的第一阶段资源：CPU 请求 `100m`、限制 `500m`；内存请求 `128Mi`、限制 `512Mi`。实例数固定为 1，关闭缩容到 0 和弹性多副本。SQLite 阶段不能同时运行两个可写实例。

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
| 管理员密码 | 用户指定密码，通过 `ADMIN_PASSWORD` Secret 注入 |
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

## 4. 上线验收地址

- 月下心笺旧入口：`https://vanxwdsqrvsy.sealosbja.site/`
- 月下心笺规范入口：`https://vanxwdsqrvsy.sealosbja.site/tests/moonlit-fate/`
- 内在三声部：`https://vanxwdsqrvsy.sealosbja.site/tests/inner-voices/`
- 管理后台：`https://vanxwdsqrvsy.sealosbja.site/admin/`
- 就绪状态：`https://vanxwdsqrvsy.sealosbja.site/health/ready`

## 5. 发布与回滚

发布前：执行完整测试、生成数据库备份、记录当前镜像摘要。  
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
