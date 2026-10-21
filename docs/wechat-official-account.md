# 微信公众号 Provider（第三方平台）

Postiz 新增的 `wechat` provider 通过微信开放平台「第三方平台」代公众号调用接口，支持草稿创建、发布和发布状态查询。

## 1. 前置条件

1. **企业认证公众号**  
   2025 年 7 月起，个人主体、企业未认证主体及不支持认证的账号会被回收发布接口权限。请使用已认证的企业主体服务号/订阅号。

2. **微信开放平台第三方平台**

   - 在 <https://open.weixin.qq.com> 创建第三方平台（需企业开发者资质）。
   - 记录 `component_appid`、`component_appsecret`。
   - 配置消息校验 `Token` 和 `EncodingAESKey`（43 位）。
   - 配置：
     - **授权事件接收 URL**：`https://<PUBLIC_BASE>/api/wx/auth`
     - **消息与事件接收 URL**：`https://<PUBLIC_BASE>/api/wx/$APPID$`
     - 服务器 IP 白名单：Postiz 服务器的出口 IP
   - 授权回调域 / redirect_uri：`https://<FRONTEND_URL>/integrations/social/wechat`

3. **权限集**  
   公众号授权时勾选「素材管理」（ID 11）；建议同时勾选「群发与通知」（ID 7）。
   微信实际权限列表中没有 100，Provider 不再强制 100；发布时权限不足会由微信返回 48001。

## 2. 环境变量

```env
WECHAT_COMPONENT_APPID=
WECHAT_COMPONENT_APPSECRET=
WECHAT_COMPONENT_TOKEN=
WECHAT_COMPONENT_AES_KEY=          # 43 位 EncodingAESKey
WECHAT_COMPONENT_REDIRECT_URI=https://<FRONTEND_URL>/integrations/social/wechat
```

配置后重启 backend。

## 3. 授权流程

1. Postiz → Add Channel → 微信公众号 → 扫码授权。
2. Provider 调 `component/api_create_preauthcode` 生成授权页。
3. 公众号管理员扫码并勾选权限集。
4. 微信回调 `redirect_uri?state=...&auth_code=...`。
5. Postiz 调 `component/api_query_auth` 换 `authorizer_access_token` / `authorizer_refresh_token`，并用 `api_get_authorizer_info` 补公众号名称/头像/认证状态。
6. 账号出现在 Postiz 渠道列表，`Integration.token` 存 authorizer token，`refreshToken` 存 `appid|refresh_token`。

## 4. 发布与群发行为

新建微信文章时可在「发布方式」里选择两种模式，默认是「发布」。

公共步骤：

- 第一张图片作为封面：上传到永久素材 `material/add_material?type=image` → `thumb_media_id`。
- 正文 `<img>` 和其余图片：上传到 `media/uploadimg`，替换为微信托管 URL。
- 创建草稿：`draft/add`（title/author/digest/content/thumb_media_id）。

### 4.1 发布（publish，默认）

- 提交发布：`freepublish/submit` → `publish_id`。
- 状态轮询：provider 返回 `pending`，Postiz workflow 每 20 秒调 `freepublish/get`，成功后回写文章 URL。
- 效果：文章进入公众号历史消息，**不会推送给粉丝**，不消耗群发次数。

### 4.2 群发（mass）

- 群发接口：`message/mass/sendall`，消息类型 `mpnews`，`filter.is_to_all = true`，`media_id` 复用刚创建的草稿。
- 状态轮询：`message/mass/get`，`SEND_SUCCESS` 即完成；微信群发后会删除草稿，且不通过 API 返回群发文章的稳定链接，因此这条 Post 不写 `releaseURL`，文章可在公众号历史消息/粉丝聊天中查看。
- 效果：推送给**全部粉丝**，消耗群发配额（订阅号每天 1 次，服务号每月 4 次），无法按标签/分组筛选。
- 群发不是「发布」的替代：群发成功后文章也会出现在历史消息中；不要对同一篇文章重复执行两种模式。
- 定时发布：复用 Postiz 的 Temporal 排期，到点后按所选模式执行，不需要额外调度器。

## 5. 限制

- 标题 ≤ 32 字、作者 ≤ 16 字、摘要 ≤ 120 字、正文 ≤ 20,000 字符。
- 仅支持图文；视频上传/嵌入、留言管理、数据统计暂未实现。
- 群发只支持「全部粉丝」，不支持按标签/性别/地域筛选；配额用完后需等次日（订阅号）或下月（服务号）恢复。
- 微信群发后草稿会被删除，且没有接口返回群发文章的稳定 URL；Postiz 只记录 `msg_id`/`msg_data_id`，文章链接需到公众号历史消息中获取。
- 同一公众号绑定到多个组织时，微信可能使旧 `authorizer_refresh_token` 失效；建议一个公众号只绑定一个组织。
- 微信没有发布幂等键；发布请求超时可能已提交，重试前建议先检查公众号后台。

## 6. 常见错误码

| errcode       | 含义              | 处理                                        |
| ------------- | ----------------- | ------------------------------------------- |
| 40001 / 42001 | access_token 失效 | Provider 抛 `RefreshToken`，自动刷新后重试  |
| 40164         | IP 不在白名单     | 把 Postiz 出口 IP 加入开放平台/公众号白名单 |
| 48001         | 无接口权限        | 确认企业认证、素材管理（11）/群发与通知（7） |
| 45009         | 接口频率限制      | 稍后重试                                    |
| 45027         | 群发操作过于频繁  | 稍后重试                                    |
| 45028         | 群发次数已用完    | 等配额恢复，或改用「发布」模式              |
| 45002         | 内容超长          | 精简正文                                    |
| 40007 / 40009 | 素材/图片无效     | 重新上传图片                                |

## 7. 文件位置

| 文件                                                                                  | 作用                        |
| ------------------------------------------------------------------------------------- | --------------------------- |
| `libraries/nestjs-libraries/src/integrations/social/wechat.provider.ts`               | Provider 实现               |
| `libraries/nestjs-libraries/src/integrations/wechat/wechat.component.service.ts`      | 第三方平台 token / 授权服务 |
| `libraries/nestjs-libraries/src/integrations/wechat/wechat.crypto.ts`                 | 回调验签 / AES 解密         |
| `libraries/nestjs-libraries/src/dtos/posts/providers-settings/wechat.settings.dto.ts` | 图文设置 DTO                |
| `apps/backend/src/api/routes/no.auth.integrations.controller.ts`                      | 事件回调 + URL 验证         |
| `apps/frontend/src/components/new-launch/providers/wechat/wechat.provider.tsx`        | 前端 Provider/Settings      |
| `apps/frontend/public/icons/platforms/wechat.png`                                     | 渠道图标                    |
