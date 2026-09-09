# 多测试产品平台详细设计

> 文档状态：实施基准  
> 最后更新：2026-09-09  
> 适用范围：标准化测试生成器、统一兑换码后台、单个 Sealos 多测试网站

## 1. 建设目标

建设一个长期复用的测试产品平台。每套测试可以自由决定题目、选项、结果算法、页面结构和视觉表现；平台只统一授权、数据、后台、发布和运行保障。

第一阶段完成后必须同时满足：

1. 现有“月下心笺”保持可用，旧入口可以继续访问。
2. “内在三声部”48 题人格测试上线，并使用同一套授权服务。
3. 一个 Sealos 应用承载多套测试，不为每套测试复制服务器。
4. 管理后台可从公网 `/admin/` 访问，账号密码登录后才能使用。
5. 后台可以管理测试、兑换码批次、订单发码、禁用与解绑、导入导出、统计和审计日志。
6. 新测试可以通过标准测试包接入，也可以完全自定义前端。
7. 数据存放在持久化卷，具备自动备份、健康检查和恢复流程。

## 2. 范围边界

### 2.1 本系统负责

- 测试项目注册、版本和入口管理。
- 题目、选项、评分、结果与页面的标准接入协议。
- 兑换码生成、加密存储、分配、兑换、禁用和设备解绑。
- 管理员登录、会话、权限校验和操作审计。
- 静态测试页面托管、统一 API、健康检查和日志。
- Sealos 镜像构建、部署、持久化和备份恢复。
- 为未来订单渠道 API 预留交付适配器。

### 2.2 明确不负责

- 小红书个人售卖订单真实性自动校验；当前没有可依赖的订单接口。
- 支付、退款和平台消息自动发送。

## 3. 核心原则

### 3.1 固定底座，开放测试

底座固定：登录、授权、兑换码、数据、发布、监控、备份。  
测试开放：题型、题数、选项数、分支、算法、结果、页面和素材。

### 3.2 一个运行平台，多种测试实现

平台同时支持三种接入模式：

| 模式 | 实现方式 | 适用情况 |
| --- | --- | --- |
| 标准配置 | 清单、题库、评分策略、主题令牌 | 常规人格、量表、知识和匹配测试 |
| 深度定制 | 使用平台 SDK，自定义 React 页面 | 页面结构和交互有明显特色 |
| 完全定制 | 独立静态应用，只接入授权 SDK | 剧情、动画或特殊玩法 |

三种模式使用同样的兑换码和后台 API，不要求视觉一致。

### 3.3 版本不可变，发布可回滚

测试包发布后形成不可变版本。修改内容应产生新版本；线上入口只指向某个已发布版本，出现问题时可以切回上一版本。

### 3.4 低成本优先，保留升级路径

第一阶段采用单实例 Node.js + SQLite + Sealos 持久化卷。该结构没有额外数据库实例费用，适合当前业务量。数据访问集中在仓储层，将来可迁移 PostgreSQL；多实例扩容前必须先迁移数据库，不能让多个实例分别写本地 SQLite。

## 4. 总体架构

```text
公网域名
   |
   +-- /                         月下心笺旧入口兼容
   +-- /tests/moonlit-fate/      月下心笺正式入口
   +-- /tests/inner-voices/      内在三声部正式入口
   +-- /admin/                   统一管理后台
   +-- /api/public/*             测试授权 API
   +-- /api/admin/*              登录后管理 API
   +-- /health/live              进程存活探针
   +-- /health/ready             数据库和存储就绪探针
          |
          +-- HTTP 路由与静态文件服务
          +-- 管理员认证与安全会话
          +-- 测试项目注册表
          +-- 兑换码领域服务
          +-- SQLite 数据库
          +-- 审计日志和定时备份
```

## 5. 目录与测试包协议

目标目录：

```text
apps/
  platform-web/                 管理后台和共享前端 SDK
  tests/
    moonlit-fate/               深度定制测试
    inner-voices/               完全定制测试
server/
  index.mjs                     服务入口
  auth/                         管理员认证与会话
  db/                           schema、迁移、仓储
  domains/                      tests、licenses、orders、audit
  routes/                       public、admin、health
  services/                     encryption、backup、static
packages/
  test-sdk/                     浏览器授权和设备标识 SDK
  test-schema/                  清单与标准题库校验
  test-generator/               新测试脚手架
tests-registry.json             已安装测试清单
docs/                           设计、实施、部署和恢复文档
```

每套测试必须提供 `test.manifest.json`：

```json
{
  "schemaVersion": 1,
  "slug": "inner-voices",
  "name": "内在三声部",
  "version": "1.0.0",
  "mode": "custom-static",
  "entry": "index.html",
  "licenseRequired": true,
  "resultStorageKey": "innerVoices:lastResult:v2"
}
```

标准配置模式还可以提供 `questions.json`、`results.json`、`scoring.json` 和 `theme.json`。完全定制模式无需服从统一页面结构，只需在开始答题前调用测试 SDK 完成授权。

## 6. 统一授权流程

```text
打开测试
  -> SDK 读取浏览器设备 ID 和已有授权令牌
  -> POST /api/public/licenses/verify
  -> 已授权：进入测试
  -> 未授权：显示该测试自己的兑换弹窗
  -> POST /api/public/licenses/redeem
  -> 首次兑换绑定测试、兑换码和设备
  -> 返回签名授权令牌
  -> 同一浏览器以后可以重复测试
```

兑换码默认只解锁一个测试。数据库预留 `entitlement_scope`，以后可支持测试合集。

## 7. 数据模型

### 7.1 tests

- `id`、`slug`、`name`、`description`
- `mode`、`status`、`entry_path`
- `active_version`、`created_at`、`updated_at`

### 7.2 test_versions

- `id`、`test_id`、`version`
- `manifest_json`、`artifact_digest`
- `status`、`created_at`、`published_at`

### 7.3 code_batches

- `id`、`test_id`、`name`
- `prefix`、`total_count`、`created_at`

### 7.4 licenses

- `id`、`test_id`、`batch_id`
- `code_hash`：用于唯一校验，绝不保存明文索引。
- `code_ciphertext`：AES-256-GCM 加密后的可发放兑换码。
- `status`：`available`、`allocated`、`redeemed`、`disabled`。
- `order_ref`、`device_hash`
- `created_at`、`allocated_at`、`redeemed_at`、`disabled_at`

### 7.5 admin_sessions / audit_logs

记录登录会话、动作、对象、时间和必要的非敏感上下文。审计日志不记录密码、完整兑换码和会话令牌。

## 8. 兑换码安全和并发

- 原始兑换码使用系统随机数生成，排除容易混淆的字符。
- 数据库存 SHA-256 摘要和 AES-256-GCM 密文。
- 加密密钥、会话密钥和管理员密码只通过 Sealos Secret 注入。
- “分配下一个兑换码”在数据库事务内完成，避免重复发放。
- 后台默认只展示掩码；分配成功时展示一次完整兑换码，并允许复制回复文案。
- 导出属于审计动作，文件响应禁止缓存。
- 登录接口按 IP 限速；Cookie 为 HttpOnly、SameSite=Strict，公网 HTTPS 下启用 Secure。

## 9. 公网管理后台

后台入口为 `/admin/`。初始管理员用户名由 `ADMIN_USERNAME` 配置，密码由 `ADMIN_PASSWORD` 或 `ADMIN_PASSWORD_HASH` 配置。生产环境必须设置 `SESSION_SECRET` 与 `CODE_ENCRYPTION_KEY`。

页面范围：

1. 登录页：用户名、密码、错误提示和退出其他会话能力。
2. 总览：测试数量、可用码、已分配、已兑换、异常和最近操作。
3. 测试项目：状态、入口、版本、兑换统计。
4. 兑换码批次：生成、导入、导出、禁用、查看余量。
5. 订单发码：选择测试、输入订单号、原子分配、复制买家回复。
6. 兑换码查询：按兑换码或订单号查询，支持解绑和停用。
7. 系统：备份状态、手动备份、健康信息和退出登录。

## 10. 旧数据迁移

现有 `licenses.json` 可能只包含兑换码摘要和设备绑定；现有 1000 个明文码在部署目录外单独保存。迁移器必须：

1. 先备份旧 JSON。
2. 将旧记录全部归属到 `moonlit-fate`。
3. 保留原创建时间、批次、设备摘要和兑换时间。
4. 通过后台导入明文清单，将相同摘要的记录补充为加密密文，不改变使用状态。
5. 重复运行迁移器不得产生重复数据。
6. 导入报告必须显示新增、补全、重复和无效数量。

## 11. 备份、恢复和可用性

- `/app/data` 必须挂载持久化卷；数据库和备份都位于该目录。
- 每日生成 SQLite 一致性备份，至少保留最近 14 份。
- 每次数据库迁移和批量导入前额外生成备份。
- `/health/live` 只检查进程；`/health/ready` 检查数据库、迁移状态和数据目录可写。
- Sealos 保持一个常驻实例，不自动缩容到 0。
- 容器先通过就绪探针再接收公网流量，停止时先结束新请求再退出。
- 恢复流程包括停止写入、校验备份、替换数据库、完整性检查和重新启动。

## 12. 测试生成器

命令：

```text
npm run test:new -- --slug new-test --name "新测试" --mode standard
npm run test:validate
npm run build:platform
```

生成器负责目录、清单、示例页面、授权 SDK 接入和校验脚本，不替测试决定创意。校验至少覆盖：

- slug、版本和入口唯一。
- 题目、选项和结果引用完整。
- 标准评分策略输出有效结果。
- 所有静态资源存在。
- 页面能在授权前阻止进入答题。
- 构建产物不包含管理员密码、会话密钥或明文兑换码。

## 13. 当前交付流程

小红书发送固定夸克链接和固定说明；管理员在公网后台为真实订单分配兑换码。后台生成可直接复制的买家回复。订单渠道适配器接口保留，但在没有可验证订单 API 前不启用买家自助领码。

## 14. 环境变量

| 变量 | 必填 | 用途 |
| --- | --- | --- |
| `PORT` | 否 | HTTP 端口，默认 8787 |
| `DATA_DIR` | 是 | 持久化数据目录，生产为 `/app/data` |
| `ADMIN_USERNAME` | 是 | 管理员用户名 |
| `ADMIN_PASSWORD` / `ADMIN_PASSWORD_HASH` | 是 | 管理员密码来源 |
| `SESSION_SECRET` | 是 | 管理会话签名 |
| `LICENSE_TOKEN_SECRET` | 是 | 用户授权令牌签名 |
| `LEGACY_LICENSE_TOKEN_SECRET` | 迁移时 | 兼容旧月下心笺浏览器令牌；可继续保留原 `MOONLIT_TOKEN_SECRET` |
| `CODE_ENCRYPTION_KEY` | 是 | 兑换码加密 |
| `PUBLIC_BASE_URL` | 是 | 公网基础地址 |

## 15. 第一阶段验收标准

- 两套测试在同一容器、同一域名、不同路径可访问。
- 两套测试都必须使用各自测试范围内的兑换码，不能交叉解锁。
- 旧月下心笺兑换码与设备绑定状态迁移后保持有效。
- 公网后台未登录访问管理 API 返回 401，登录后功能正常。
- 连续并发分配兑换码不会返回同一个码。
- 管理员可以生成、导入、分配、查询、禁用、解绑和导出。
- 重启容器后数据库、会话策略和兑换记录不丢失。
- 自动备份可生成，按恢复手册可以恢复。
- 健康探针、容器构建、服务测试和两套前端验证全部通过。
