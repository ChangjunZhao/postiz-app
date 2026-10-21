import { Integration } from '@prisma/client';
import {
  AuthTokenDetails,
  GenerateAuthUrlResponse,
  PendingCheckResponse,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import {
  BadBody,
  RefreshToken,
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import { Rules } from '@gitroom/nestjs-libraries/chat/rules.description.decorator';
import { timer } from '@gitroom/helpers/utils/timer';
import { WechatSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/wechat.settings.dto';
import { wechatComponentService } from '@gitroom/nestjs-libraries/integrations/wechat/wechat.component.service';

const API_BASE = 'https://api.weixin.qq.com';
const MAX_CONTENT_LENGTH = 20000;
const MAX_TITLE_LENGTH = 32;
const MAX_DIGEST_LENGTH = 120;
const MAX_AUTHOR_LENGTH = 16;

/**
 * 微信公众号（第三方平台代公众号调用）。
 *
 * 授权走微信开放平台「第三方平台」：component_access_token 由
 * WechatComponentService 维护，公众号的 authorizer_access_token /
 * authorizer_refresh_token 存在 Integration.token / refreshToken。
 */
@Rules(
  'WeChat Official Account publishes long-form articles. A title (max 32 characters), optional digest (max 120 characters), and at least one image are required; the first image is used as the cover.'
)
export class WechatProvider extends SocialAbstract implements SocialProvider {
  identifier = 'wechat';
  name = '微信公众号';
  isBetweenSteps = false;
  scopes = [] as string[];
  editor = 'html' as const;
  dto = WechatSettingsDto;
  toolTip = '仅支持已认证企业主体公众号';
  refreshCron = true;
  inlineImages = () => true;
  override maxConcurrentJob = 3;

  maxLength() {
    return MAX_CONTENT_LENGTH;
  }

  async generateAuthUrl(): Promise<GenerateAuthUrlResponse> {
    const state = makeSecureId(17);
    const baseRedirect = process.env.WECHAT_COMPONENT_REDIRECT_URI;
    if (!baseRedirect) {
      throw new Error('WECHAT_COMPONENT_REDIRECT_URI 未配置');
    }

    // WeChat's component login page does not reliably echo a `state` param,
    // so carry our state inside the redirect_uri itself.
    const redirect = new URL(baseRedirect);
    redirect.searchParams.set('state', state);

    const url = await wechatComponentService.getAuthUrl(redirect.toString());

    return {
      url,
      codeVerifier: makeSecureId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }): Promise<AuthTokenDetails | string> {
    try {
      const authorization = await wechatComponentService.queryAuth(params.code);
      const authorizerAppid = authorization.authorizer_appid;

      const details = await wechatComponentService.getAuthorizerInfo(
        authorizerAppid
      );
      const authorizerInfo = details?.authorizer_info || {};
      const verifyType = authorizerInfo?.verify_type_info?.id;

      // -1 = 未认证。2025-07 起微信已回收未认证主体的发布接口权限。
      if (verifyType === -1) {
        return '该公众号未完成微信认证，微信已回收发布接口权限，无法自动发布。请使用已认证的企业主体公众号。';
      }

      const funcInfo =
        authorization.func_info || details?.authorization_info?.func_info || [];
      const funcIds = (funcInfo || []).map(
        (f: any) => f?.funcscope_category?.id
      );

      // 微信后台实际权限列表：11 = 素材管理（上传封面/正文图必需）；列表中
      // 没有 100。发布能力/群发权限由 freepublish/submit 在发布时校验，
      // 因此这里只要求素材管理，避免误拦已授权的公众号。
      if (!funcIds.includes(11)) {
        return '该公众号未授权素材管理权限（权限集 11）。请重新扫码授权，并勾选「素材管理」。';
      }

      const accessToken = authorization.authorizer_access_token;
      const refreshToken = authorization.authorizer_refresh_token;
      if (!accessToken || !refreshToken) {
        return '微信授权信息不完整（缺少 access_token 或 refresh_token），请重新授权。';
      }

      return {
        id: authorizerAppid,
        name:
          authorizerInfo.nick_name ||
          authorizerInfo.user_name ||
          authorizerAppid,
        accessToken,
        refreshToken: `${authorizerAppid}|${refreshToken}`,
        expiresIn: Number(authorization.expires_in || 7200),
        picture: authorizerInfo.head_img || '',
        username:
          authorizerInfo.alias || authorizerInfo.user_name || authorizerAppid,
      };
    } catch (err: any) {
      return `微信公众号授权失败：${err?.message || err}`;
    }
  }

  async refreshToken(refresh_token: string): Promise<AuthTokenDetails> {
    const [authorizerAppid, token] = (refresh_token || '').split('|');

    if (!authorizerAppid || !token) {
      throw new Error('微信公众号 refresh token 无效，请重新授权');
    }

    const data = await wechatComponentService.refreshAuthorizerToken(
      authorizerAppid,
      token
    );

    if (!data?.authorizer_access_token || !data?.authorizer_refresh_token) {
      throw new Error('微信刷新 token 失败：返回信息不完整，请重新授权');
    }

    return {
      id: authorizerAppid,
      name: '',
      accessToken: data.authorizer_access_token,
      refreshToken: `${authorizerAppid}|${data.authorizer_refresh_token}`,
      expiresIn: Number(data.expires_in || 7200),
      username: authorizerAppid,
    };
  }

  override async checkValidity(
    [firstPost]: Array<ValidityMedia[]>,
    settings: any,
    _additionalSettings: any[]
  ): Promise<string | true> {
    const title = (settings?.title || '').trim();
    if (!title) {
      return '请填写微信公众号文章标题';
    }
    if (title.length > MAX_TITLE_LENGTH) {
      return `微信公众号标题不能超过 ${MAX_TITLE_LENGTH} 个字`;
    }
    if ((settings?.digest || '').length > MAX_DIGEST_LENGTH) {
      return `微信公众号摘要不能超过 ${MAX_DIGEST_LENGTH} 个字`;
    }
    if ((settings?.author || '').length > MAX_AUTHOR_LENGTH) {
      return `微信公众号作者不能超过 ${MAX_AUTHOR_LENGTH} 个字`;
    }

    const hasCover =
      !!settings?.thumb?.path || !!(firstPost && firstPost.length);
    if (!hasCover) {
      return '微信公众号图文需要至少一张封面图';
    }

    return true;
  }

  async postPending(
    _id: string,
    accessToken: string,
    postDetails: PostDetails[],
    _integration: Integration
  ): Promise<PostResponse[]> {
    const post = postDetails[0];
    if (!post) {
      throw new BadBody(
        this.identifier,
        '{}',
        '{}',
        '微信公众号没有可发布的内容'
      );
    }

    const settings = (post.settings || {}) as WechatSettingsDto;
    const media = post.media || [];
    const images = media.filter((item) => item?.path && item.type !== 'video');
    const title =
      (settings.title || '').trim() ||
      this.stripHtml(post.message).slice(0, MAX_TITLE_LENGTH);
    if (!title) {
      throw new BadBody(
        this.identifier,
        '{}',
        '{}',
        '请填写微信公众号文章标题'
      );
    }

    const coverPath = settings.thumb?.path || images[0]?.path;
    if (!coverPath) {
      throw new BadBody(
        this.identifier,
        '{}',
        '{}',
        '微信公众号图文需要至少一张封面图（视频暂不能作为封面）'
      );
    }

    const thumbMediaId = await this.uploadPermanentImage(
      accessToken,
      coverPath
    );
    const content = await this.prepareContent(
      accessToken,
      post.message || '',
      images,
      coverPath
    );

    const digest =
      (settings.digest || '').trim() ||
      this.stripHtml(post.message).slice(0, MAX_DIGEST_LENGTH);

    const draft = await this.request<any>('/cgi-bin/draft/add', accessToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        articles: [
          {
            title,
            author: (settings.author || '').slice(0, MAX_AUTHOR_LENGTH),
            digest,
            content,
            ...(settings.content_source_url
              ? { content_source_url: settings.content_source_url }
              : {}),
            thumb_media_id: thumbMediaId,
            need_open_comment: this.flag(settings.need_open_comment) ? 1 : 0,
            only_fans_can_comment: this.flag(settings.only_fans_can_comment)
              ? 1
              : 0,
          },
        ],
      }),
    });

    if (!draft?.media_id) {
      throw new BadBody(
        this.identifier,
        JSON.stringify(draft),
        '{}',
        '微信草稿创建失败：未返回 media_id'
      );
    }

    const mode = settings.publish_mode === 'mass' ? 'mass' : 'publish';

    if (mode === 'mass') {
      const mass = await this.request<any>(
        '/cgi-bin/message/mass/sendall',
        accessToken,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filter: { is_to_all: true },
            mpnews: { media_id: draft.media_id },
            msgtype: 'mpnews',
            send_ignore_reprint: 0,
          }),
        }
      );

      if (!mass?.msg_id) {
        throw new BadBody(
          this.identifier,
          JSON.stringify(mass),
          '{}',
          '微信群发提交失败：未返回 msg_id'
        );
      }

      return [
        {
          id: post.id,
          postId: String(mass.msg_data_id || mass.msg_id),
          releaseURL: '',
          status: 'pending',
          pendingData: {
            mode: 'mass',
            msgId: mass.msg_id,
            msgDataId: mass.msg_data_id,
            draftMediaId: draft.media_id,
            title,
          },
        },
      ];
    }

    const publish = await this.request<any>(
      '/cgi-bin/freepublish/submit',
      accessToken,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_id: draft.media_id }),
      }
    );

    if (!publish?.publish_id) {
      throw new BadBody(
        this.identifier,
        JSON.stringify(publish),
        '{}',
        '微信发布提交失败：未返回 publish_id'
      );
    }

    const publishId = String(publish.publish_id);

    return [
      {
        id: post.id,
        postId: publishId,
        releaseURL: '',
        status: 'pending',
        pendingData: {
          mode: 'publish',
          publishId,
          draftMediaId: draft.media_id,
        },
      },
    ];
  }

  async post(
    _id: string,
    accessToken: string,
    postDetails: PostDetails[],
    _integration: Integration
  ): Promise<PostResponse[]> {
    const [pending] = await this.postPending(
      _id,
      accessToken,
      postDetails,
      _integration
    );

    if (pending.status !== 'pending') {
      return [pending];
    }

    let pendingData = pending.pendingData;
    for (let i = 0; i < 30; i++) {
      const result = await this.checkPostStatus(
        accessToken,
        pendingData,
        _integration
      );

      if (result.status === 'completed') {
        return [
          {
            ...pending,
            postId: result.postId,
            releaseURL: result.releaseURL,
            status: 'success',
            pendingData: undefined,
          },
        ];
      }

      pendingData = result.pendingData;
      await timer(2000);
    }

    throw new BadBody(
      this.identifier,
      JSON.stringify({ publishId: pendingData?.publishId }),
      '{}',
      '微信发布已提交，但状态尚未确认，请到公众号后台检查后再手动重试'
    );
  }

  override async checkPostStatus(
    accessToken: string,
    pendingData: any,
    _integration: Integration
  ): Promise<PendingCheckResponse> {
    if (pendingData.mode === 'mass') {
      const result = await this.request<any>(
        '/cgi-bin/message/mass/get',
        accessToken,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ msg_id: Number(pendingData.msgId) }),
        }
      );

      const msgStatus = result?.msg_status;
      if (msgStatus === 'SEND_SUCCESS') {
        // WeChat deletes the draft after a mass send and does not expose a
        // stable article URL for mass-sent messages through the API, so the
        // post is finalized without a releaseURL. The article is available
        // in the account's history/chat.
        return {
          status: 'completed',
          postId: String(pendingData.msgDataId || pendingData.msgId),
          releaseURL: '',
        };
      }

      if (!msgStatus || msgStatus === 'SENDING') {
        return { status: 'pending', pendingData };
      }

      throw new BadBody(
        this.identifier,
        JSON.stringify(result),
        '{}',
        `微信群发失败：${msgStatus}`
      );
    }

    const data = await this.request<any>(
      '/cgi-bin/freepublish/get',
      accessToken,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publish_id: pendingData.publishId }),
      }
    );

    const status = Number(data.publish_status);

    if (status === 0) {
      const item = data.article_detail?.item?.[0];
      return {
        status: 'completed',
        postId: String(data.article_id || pendingData.publishId),
        releaseURL: item?.article_url || item?.url || '',
      };
    }

    if (status === 1) {
      return { status: 'pending', pendingData };
    }

    throw new BadBody(
      this.identifier,
      JSON.stringify(data),
      '{}',
      data.errmsg || `微信发布失败（publish_status=${data.publish_status}）`
    );
  }

  override handleErrors(
    body: string,
    _status: number
  ):
    | {
        type: 'refresh-token' | 'bad-body' | 'retry';
        value: string;
      }
    | undefined {
    let code = 0;
    let message = '';
    try {
      const data = JSON.parse(body);
      code = Number(data.errcode || 0);
      message = data.errmsg || '';
    } catch {
      return undefined;
    }

    if (code === 40001 || code === 42001) {
      return {
        type: 'refresh-token',
        value: message || '微信 access_token 失效',
      };
    }
    if (code === 40164) {
      return {
        type: 'bad-body',
        value:
          '服务器 IP 不在微信公众号/开放平台白名单中，请把服务器出口 IP 加入 IP 白名单',
      };
    }
    if (code === 45009) {
      return {
        type: 'retry',
        value: '微信接口频率受限，请稍后重试',
      };
    }
    if (code === 48001) {
      return {
        type: 'bad-body',
        value: '该公众号没有此接口权限，需要已认证企业主体并授权草稿/发布权限',
      };
    }
    if (code === 45028) {
      return {
        type: 'bad-body',
        value:
          '微信群发次数已用完（订阅号每天 1 次，服务号每月 4 次），请改用「发布」或下期再试',
      };
    }
    if (code === 45027) {
      return {
        type: 'bad-body',
        value: '微信群发过于频繁，请稍后再试',
      };
    }
    if (code === 45002) {
      return {
        type: 'bad-body',
        value: '微信正文内容超长，请精简后重试',
      };
    }
    if (code === 40007 || code === 40009) {
      return {
        type: 'bad-body',
        value: '微信素材或图片无效，请重新上传后重试',
      };
    }
    if (code) {
      return { type: 'bad-body', value: message || `微信接口错误 ${code}` };
    }

    return undefined;
  }

  private async request<T = any>(
    path: string,
    accessToken: string,
    init: RequestInit
  ): Promise<T> {
    const url = `${API_BASE}${path}${
      path.includes('?') ? '&' : '?'
    }access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url, {
      ...init,
      signal: init.signal || AbortSignal.timeout(60000),
    });
    const data: any = await res.json().catch(() => ({}));
    const errcode = Number(data?.errcode || 0);

    if (errcode) {
      const mapped = this.handleErrors(JSON.stringify(data), res.status);
      if (mapped?.type === 'refresh-token') {
        throw new RefreshToken(
          this.identifier,
          JSON.stringify(data),
          '{}',
          mapped.value
        );
      }
      throw new BadBody(
        this.identifier,
        JSON.stringify(data),
        '{}',
        mapped?.value || data.errmsg || '微信接口调用失败'
      );
    }

    return data as T;
  }

  private async uploadPermanentImage(
    accessToken: string,
    path: string
  ): Promise<string> {
    const data = await this.uploadImage(
      '/cgi-bin/material/add_material?type=image',
      accessToken,
      path
    );

    if (!data?.media_id) {
      throw new BadBody(
        this.identifier,
        JSON.stringify(data),
        '{}',
        '微信封面上传失败：未返回 media_id'
      );
    }

    return data.media_id;
  }

  private async uploadInlineImage(
    accessToken: string,
    path: string
  ): Promise<string> {
    const data = await this.uploadImage(
      '/cgi-bin/media/uploadimg',
      accessToken,
      path
    );

    if (!data?.url) {
      throw new BadBody(
        this.identifier,
        JSON.stringify(data),
        '{}',
        '微信正文图片上传失败：未返回 url'
      );
    }

    return data.url;
  }

  private async uploadImage(
    path: string,
    accessToken: string,
    mediaPath: string
  ): Promise<any> {
    const buffer = await this.readOrFetch(mediaPath);
    const filename = this.fileName(mediaPath);
    const form = new FormData();
    form.append(
      'media',
      new Blob([new Uint8Array(buffer)], {
        type: this.contentType(filename),
      }),
      filename
    );

    return this.request<any>(path, accessToken, {
      method: 'POST',
      body: form,
    });
  }

  private async prepareContent(
    accessToken: string,
    message: string,
    media: PostDetails['media'],
    coverPath: string
  ): Promise<string> {
    let html = message || '';

    const imageRegex = /(<img[^>]+src=["'])([^"']+)(["'][^>]*>)/gi;
    const matches = Array.from(html.matchAll(imageRegex));
    for (const match of matches) {
      const src = match[2];
      if (!src || src.startsWith('data:') || src.includes('mmbiz.qpic.cn')) {
        continue;
      }

      const url = await this.uploadInlineImage(
        accessToken,
        this.normalizeMediaPath(src)
      );
      html = html.replace(match[0], `${match[1]}${url}${match[3]}`);
    }

    const extras = (media || []).filter(
      (item) => item?.path && item.path !== coverPath
    );
    for (const item of extras) {
      const url = await this.uploadInlineImage(accessToken, item.path);
      html += `<p><img src="${url}" /></p>`;
    }

    if (!/<(p|h[1-6]|ul|ol|li|section|blockquote|img)\b/i.test(html)) {
      html = html
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `<p>${line}</p>`)
        .join('');
    }

    if (html.length > MAX_CONTENT_LENGTH) {
      throw new BadBody(
        this.identifier,
        JSON.stringify({ length: html.length }),
        '{}',
        `微信正文不能超过 ${MAX_CONTENT_LENGTH} 个字符`
      );
    }

    return html;
  }

  private normalizeMediaPath(path: string): string {
    if (path.startsWith('http')) {
      return path;
    }

    return `${(process.env.FRONTEND_URL || '').replace(
      /\/$/,
      ''
    )}/${path.replace(/^\//, '')}`;
  }

  private fileName(path: string): string {
    const clean = path.split('?')[0];
    const name = clean.split('/').pop() || 'image.png';
    return name.includes('.') ? name : `${name}.png`;
  }

  private contentType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const types: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
    };
    return types[ext] || 'image/png';
  }

  private stripHtml(html: string): string {
    return (html || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private flag(value: any): boolean {
    return value === true || value === 'true' || value === 1 || value === '1';
  }
}
