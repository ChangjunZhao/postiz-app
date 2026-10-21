import { XMLParser } from 'fast-xml-parser';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { WechatCrypto } from './wechat.crypto';

const TICKET_KEY = 'wechat:component:verify_ticket';
const COMPONENT_TOKEN_KEY = 'wechat:component:access_token';

type Query = Record<string, any>;

/**
 * 微信开放平台第三方平台（component）服务。
 *
 * 这是部署级能力：一个 Postiz 实例只配置一个第三方平台 AppID，
 * 所有组织的公众号授权都共用这套 component_access_token / ticket；
 * 每个公众号的 authorizer_access_token 存在各自 Integration 记录里。
 */
export class WechatComponentService {
  private get appId() {
    return process.env.WECHAT_COMPONENT_APPID || '';
  }

  private get appSecret() {
    return process.env.WECHAT_COMPONENT_APPSECRET || '';
  }

  private get crypto() {
    return new WechatCrypto(
      process.env.WECHAT_COMPONENT_TOKEN || '',
      process.env.WECHAT_COMPONENT_AES_KEY || '',
      this.appId
    );
  }

  verifyUrl(signature: string, timestamp: string, nonce: string): boolean {
    return this.crypto.verifySignature(signature, timestamp, nonce);
  }

  async getComponentAccessToken(): Promise<string> {
    const cached = await ioRedis.get(COMPONENT_TOKEN_KEY);
    if (cached) {
      return cached;
    }

    const ticket = await ioRedis.get(TICKET_KEY);
    if (!ticket) {
      throw new Error(
        '微信 component_verify_ticket 尚未收到：请先在开放平台配置授权事件接收 URL，等待微信推送（约 10 分钟）后重试'
      );
    }

    const data = await this.request('/cgi-bin/component/api_component_token', {
      component_appid: this.appId,
      component_appsecret: this.appSecret,
      component_verify_ticket: ticket,
    });

    const token = data.component_access_token;
    if (!token) {
      throw new Error('微信未返回 component_access_token');
    }

    const ttl = Math.max(60, Number(data.expires_in || 7200) - 300);
    await ioRedis.set(COMPONENT_TOKEN_KEY, token, 'EX', ttl);
    return token;
  }

  async getPreAuthCode(): Promise<string> {
    const token = await this.getComponentAccessToken();
    const data = await this.request(
      `/cgi-bin/component/api_create_preauthcode?access_token=${encodeURIComponent(
        token
      )}`,
      { component_appid: this.appId }
    );

    const code = data.pre_auth_code;
    if (!code) {
      throw new Error('微信未返回 pre_auth_code');
    }

    return code;
  }

  async getAuthUrl(redirectUri?: string): Promise<string> {
    const redirect =
      redirectUri || process.env.WECHAT_COMPONENT_REDIRECT_URI || '';
    if (!redirect) {
      throw new Error('WECHAT_COMPONENT_REDIRECT_URI 未配置');
    }

    const preAuthCode = await this.getPreAuthCode();

    return (
      'https://mp.weixin.qq.com/cgi-bin/componentloginpage' +
      `?component_appid=${encodeURIComponent(this.appId)}` +
      `&pre_auth_code=${encodeURIComponent(preAuthCode)}` +
      `&redirect_uri=${encodeURIComponent(redirect)}`
    );
  }

  async queryAuth(authCode: string): Promise<any> {
    const token = await this.getComponentAccessToken();
    const data = await this.request(
      `/cgi-bin/component/api_query_auth?access_token=${encodeURIComponent(
        token
      )}`,
      {
        component_appid: this.appId,
        authorization_code: authCode,
      }
    );

    if (!data.authorization_info?.authorizer_appid) {
      throw new Error('微信授权信息无效：缺少 authorizer_appid');
    }

    return data.authorization_info;
  }

  async getAuthorizerInfo(authorizerAppid: string): Promise<any> {
    const token = await this.getComponentAccessToken();
    return this.request(
      `/cgi-bin/component/api_get_authorizer_info?access_token=${encodeURIComponent(
        token
      )}`,
      {
        component_appid: this.appId,
        authorizer_appid: authorizerAppid,
      }
    );
  }

  async refreshAuthorizerToken(
    authorizerAppid: string,
    refreshToken: string
  ): Promise<any> {
    const token = await this.getComponentAccessToken();
    return this.request(
      `/cgi-bin/component/api_authorizer_token?access_token=${encodeURIComponent(
        token
      )}`,
      {
        component_appid: this.appId,
        authorizer_appid: authorizerAppid,
        authorizer_refresh_token: refreshToken,
      }
    );
  }

  async handleEvent(rawXml: string, query: Query): Promise<void> {
    const outer = new XMLParser({
      ignoreAttributes: false,
      trimValues: true,
    }).parse(rawXml || '');
    const encrypted = outer?.xml?.Encrypt;

    if (!encrypted || typeof encrypted !== 'string') {
      throw new Error('微信事件缺少 Encrypt 内容');
    }

    if (
      !this.crypto.verifySignature(
        query.msg_signature,
        query.timestamp,
        query.nonce,
        encrypted
      )
    ) {
      throw new Error('微信事件签名无效');
    }

    const xml = this.crypto.decrypt(encrypted);
    const info = this.crypto.parseXml(xml);

    if (
      info.InfoType === 'component_verify_ticket' &&
      info.ComponentVerifyTicket
    ) {
      await ioRedis.set(
        TICKET_KEY,
        String(info.ComponentVerifyTicket),
        'EX',
        7 * 24 * 3600
      );
    }

    if (info.AuthorizerAppid) {
      const appid = String(info.AuthorizerAppid);
      if (info.InfoType === 'unauthorized') {
        await ioRedis.set(`wechat:authorizer:${appid}:revoked`, '1');
      } else {
        await ioRedis.del(`wechat:authorizer:${appid}:revoked`);
      }
    }
  }

  private async request(path: string, body: Record<string, any>): Promise<any> {
    const res = await fetch(`https://api.weixin.qq.com${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    const data: any = await res.json();
    const errcode = Number(data?.errcode || 0);
    if (errcode) {
      throw new Error(`微信开放平台接口错误 ${errcode}: ${data.errmsg}`);
    }

    return data;
  }
}

export const wechatComponentService = new WechatComponentService();
