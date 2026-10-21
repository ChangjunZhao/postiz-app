# Postiz — postiz.sailhai.cn 部署说明

## 1. 访问地址

- 控制台/登录：<https://postiz.sailhai.cn/auth>
- API：`https://postiz.sailhai.cn/api`
- 管理员账号：`admin@sailhai.cn`（初始密码由部署人员单独交付，登录后请立即修改）
- 公开注册已关闭；如需新增账号，临时把 `/root/postiz.env` 的
  `POSTIZ_DISABLE_REGISTRATION` 设为 `false`，然后重建 postiz 容器。

## 2. 服务器结构

| 项 | 值 |
|---|---|
| 服务器 | `root@49.232.14.116` |
| 代码/构建目录 | `/root/postiz` |
| 环境变量 | `/root/postiz.env`（600，含 JWT/DB 密码） |
| Compose | 仓库 `docker-compose.yaml` + `docker-compose.override.yaml` |
| 镜像 | `postiz-local:latest`（本地源码构建，含微信公众号 provider） |
| 对外端口 | 宿主 `4007` → 容器 `5000`；由 haifan nginx 暴露 80/443 |
| 证书 | `/root/certs/postiz.sailhai.cn.crt/.key`（Let's Encrypt） |
| 上传目录 | Docker volume `postiz_postiz-uploads` |
| 数据库 | 容器 `postiz-postgres`，volume `postiz_postgres-volume` |

Postiz 栈包含：`postiz`、`postiz-postgres`、`postiz-redis`、`temporal`、
`temporal-postgresql`、`temporal-elasticsearch`。
`spotlight` / `temporal-ui` / `temporal-admin-tools` 未启动（非必需）。

## 3. 常用命令

```bash
cd /root/postiz
DC='docker compose --env-file /root/postiz.env -f docker-compose.yaml -f docker-compose.override.yaml'

$DC ps
$DC logs --tail=100 postiz
$DC up -d --force-recreate postiz        # 修改 env 后重建
$DC build postiz                         # 源码更新后重新构建
```

验证：

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://postiz.sailhai.cn/auth
curl -s https://postiz.sailhai.cn/api/integrations | grep -o '"identifier":"wechat"'
```

## 4. 微信公众号配置

在 `/root/postiz.env` 填入：

```env
WECHAT_COMPONENT_APPID=
WECHAT_COMPONENT_APPSECRET=
WECHAT_COMPONENT_TOKEN=
WECHAT_COMPONENT_AES_KEY=
```

然后 `$DC up -d --force-recreate postiz`。`WECHAT_COMPONENT_REDIRECT_URI`
自动使用 `https://postiz.sailhai.cn/integrations/social/wechat`。

微信开放平台第三方平台配置：

- 授权事件接收 URL：`https://postiz.sailhai.cn/api/wx/auth`
- 消息与事件接收 URL：`https://postiz.sailhai.cn/api/wx/$APPID$`
- 授权回调域 / redirect_uri：`https://postiz.sailhai.cn/integrations/social/wechat`
- 服务器 IP 白名单：`49.232.14.116`
- 公众号授权时勾选「素材管理」（ID 11）；如需群发还要勾选「群发与通知」（ID 7）。当前权限列表中没有 100，Provider 不再强制 100；发布时权限不足会由微信返回 48001。
- 文章编辑器里的「发布方式」默认 `publish`（只进历史消息、不推送）；选择 `mass` 会推送给全部粉丝并消耗群发配额（订阅号每天 1 次，服务号每月 4 次）。

未填这些变量前，点击「连接微信公众号」会报组件配置/ticket 相关错误，属预期。

## 5. HTTPS 与续期

- `postiz.sailhai.cn` 证书由 certbot webroot 签发，复制到 `/root/certs`。
- nginx 配置：`/root/voyage/infra/nginx-sailhai-cn/postiz.conf`（haifan 的 nginx 容器加载）。
- 续期：`/etc/cron.d/certbot-renew` 每天 03:00 执行 `certbot renew`，
  部署钩子 `/etc/letsencrypt/renewal-hooks/deploy/renew-postiz-sailhai-cn.sh`
  负责同步证书并重载 nginx。
- 到期日：2027-01-19（自动续期）。

## 6. 源码更新流程

```bash
# 本机：重新打源码包（排除 node_modules/.next/dist/.git）
cd /c/code
tar czf postiz-deploy.tar.gz --exclude=postiz-app/.git --exclude=postiz-app/node_modules \
  --exclude=postiz-app/apps/frontend/.next --exclude=postiz-app/apps/backend/dist \
  --exclude=postiz-app/apps/orchestrator/dist --exclude=postiz-app/dist \
  --exclude=postiz-app/.env postiz-app

scp -i <key> postiz-deploy.tar.gz root@49.232.14.116:/root/
ssh -i <key> root@49.232.14.116 '
  rm -rf /root/postiz-new && mkdir /root/postiz-new
  tar xzf /root/postiz-deploy.tar.gz -C /root/postiz-new --strip-components=1
  cp /root/postiz/docker-compose.override.yaml /root/postiz-new/ 2>/dev/null || true
  rm -rf /root/postiz && mv /root/postiz-new /root/postiz
  cd /root/postiz
  docker compose --env-file /root/postiz.env -f docker-compose.yaml -f docker-compose.override.yaml build postiz
  docker compose --env-file /root/postiz.env -f docker-compose.yaml -f docker-compose.override.yaml up -d --force-recreate postiz
'
```

> 更新源码时不要覆盖 `/root/postiz.env`；它位于构建目录之外，构建镜像不会包含它。

## 7. 注意事项

- 镜像构建发生在服务器上（`Dockerfile.deploy`，使用腾讯云 Debian 镜像 + 源码构建），
  首次构建约 3–5 分钟，镜像约 4.7GB。
- 服务器重启后容器会自动启动；Postiz 可能在 Temporal/DB 就绪前重启一次，属正常。
- 当前没有配置邮件服务，密码找回不可用；管理员密码请妥善保存，或在 UI 内修改。
- 建议后续增加 Postiz 数据库与 uploads 的定时备份。
- 微信真实授权/发布需要第三方平台认证完成并填好上述环境变量后再做端到端测试。

## 8. 微信排障

### 61004 access clientip is not registered

微信返回：

```json
{"errcode":61004,"errmsg":"access clientip is not registered requestIP: 49.232.14.116"}
```

说明开放平台还没把服务器出口 IP 加入白名单。到「微信开放平台 → 第三方平台 → 开发设置/基本配置 → IP 白名单」加入 `49.232.14.116`，保存后重试。

### component_verify_ticket 为空

`docker exec postiz-redis redis-cli GET wechat:component:verify_ticket` 返回空，说明
微信还没推送 ticket。检查：

1. 授权事件接收 URL 是否已保存为 `https://postiz.sailhai.cn/api/integrations/wechat/component`；
2. Token / EncodingAESKey 是否与 `/root/postiz.env` 一致；
3. URL 校验 GET 是否通过（可用浏览器打开带签名的验证 URL，或看是否保存成功）。

保存后微信每 10 分钟推送一次 ticket，最多等 10 分钟。

### 事件 POST 返回 403

- 确认镜像包含最新的 XML body parser（`text({ type: ['application/xml','text/xml'] })`）；
- 确认 `msg_signature` 与 Token/EncodingAESKey 一致；
- 确认服务器时间准确（签名含 timestamp）。