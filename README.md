# 月下心笺

《魔鬼恋人》13 人角色心动测试。前端在浏览器本地计算，兑换码由同源授权服务验证。

## 本地开发

```powershell
npm install
npm run build:offline
node server/index.mjs
```

打开 `http://127.0.0.1:8787/`。服务端需要设置 `MOONLIT_ADMIN_KEY` 才能生成兑换码。

## 兑换规则

- 兑换码只能成功兑换一次。
- 首次兑换绑定当前浏览器生成的设备 ID。
- 同一浏览器之后可以无限次测试。
- 换浏览器、无痕窗口或清除网站数据视为新设备。
- 兑换码不设过期时间，不接入支付。

## 生成兑换码

```powershell
node scripts/generate-codes.mjs 100 ./exports/codes.txt
```

生产环境建议调用管理员接口批量写入服务端：`POST /api/admin/licenses`，请求头为 `Authorization: Bearer <MOONLIT_ADMIN_KEY>`，请求体为 `{ "count": 100, "batch": "平台A" }`。

## Sealos 部署

使用仓库中的 `Dockerfile` 构建并运行，容器端口填写 `8787`。健康检查使用 `GET /api/license/status`。为 `/app/data` 挂载持久化卷，并设置：

- `PORT=8787`
- `MOONLIT_ADMIN_KEY=随机长字符串`
- `MOONLIT_TOKEN_SECRET=随机长字符串`

不要把管理密钥写入代码或提交到 Git。部署后先调用管理员接口生成少量测试码，再用浏览器验证兑换、重复测试和跨设备拒绝。

Sealos 上建议保持至少 1 个实例、关闭自动缩容到 0，并让探针使用容器端口 `8787`。公网地址在首次创建、重新部署或实例重启期间短暂显示“准备中”属于入口等待后端就绪；探针变为正常后地址会恢复可访问。若该状态持续不恢复，应先查看实例日志和容器重启次数，再检查 `/app/data` 卷权限与挂载情况。

