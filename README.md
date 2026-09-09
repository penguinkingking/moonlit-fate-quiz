# 圆宝多测试产品平台

面向日常使用的入口请先阅读 [`项目说明.md`](项目说明.md)。本文件保留给开发和排障时使用。

一个 Node.js 服务承载多套相互独立的测试、统一兑换码系统和公网管理后台。目前注册：

- `/` 与 `/tests/moonlit-fate/`：月下心笺。
- `/tests/inner-voices/`：内在三声部 48 题人格测试。
- `/admin/`：统一管理后台。

日常流程见 [`docs/00-daily-workflow.md`](docs/00-daily-workflow.md)，详细设计见 [`docs/01-system-design.md`](docs/01-system-design.md)，当前进度见 [`docs/02-implementation-checklist.md`](docs/02-implementation-checklist.md)，生产操作见 [`docs/03-deployment-runbook.md`](docs/03-deployment-runbook.md)。Windows Docker Desktop 的已知恢复方法见 [`docs/04-windows-docker-recovery.md`](docs/04-windows-docker-recovery.md)。

## 本地启动

先设置环境变量。Secret 不得写入仓库：

```powershell
$env:ADMIN_USERNAME='本地管理员账号'
$env:ADMIN_PASSWORD='本地管理员密码'
$env:SESSION_SECRET='至少32字符的独立随机值'
$env:LICENSE_TOKEN_SECRET='至少32字符的另一随机值'
$env:CODE_ENCRYPTION_KEY='至少32字符的第三个随机值'
$env:PUBLIC_BASE_URL='http://127.0.0.1:8787'
$env:DATA_DIR="$PWD/data"
npm install
npm run build:platform
npm start
```

打开 `http://127.0.0.1:8787/admin/`。首次启动会把历史 `licenses.seed.json` 摘要记录幂等迁移到 SQLite；这些旧码在后台显示为“待补全旧码”，上传原始明文清单后才可从后台分配。

## 验证

```powershell
npm run test:validate
npx tsc --noEmit --pretty false
npm run build:platform
npm test
npm audit --omit=dev
```

## 新建测试

```powershell
npm run test:new -- --slug sample-test --name "示例测试" --mode standard
npm run test:validate
```

新测试会生成到 `测试项目/<slug>/`。`standard` 会生成可直接修改的题库、结果和通用页面。特殊玩法使用 `custom-static`，或参照月下心笺建立自定义 React 构建，但仍通过共享授权 API 接入后台。

## 数据规则

- 生产数据位于 `DATA_DIR/platform.sqlite`。
- 备份位于 `DATA_DIR/backups/`，每天自动执行并默认保留 14 天。
- 兑换码按测试隔离；一码首次兑换后绑定当前浏览器设备 ID。
- 后台发码以“测试 + 订单号”为幂等键，重复提交同一订单不会消耗第二个码。
- 生产必须使用 Sealos Secret 设置密码与三个独立密钥。
