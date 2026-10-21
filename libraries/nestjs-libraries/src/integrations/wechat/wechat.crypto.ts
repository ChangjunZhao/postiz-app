import { createDecipheriv, createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

/**
 * 微信开放平台第三方平台的消息加解密（WXBizMsgCrypt）。
 *
 * 参考微信官方算法：
 * - 签名：sha1(sort(token, timestamp, nonce[, encrypt]))
 * - AES-256-CBC，key = base64(EncodingAESKey + '=')，iv = key 前 16 字节
 * - 明文：random(16) + msg_len(4, network order) + msg + appid
 */
export class WechatCrypto {
  private readonly key: Buffer;
  private readonly iv: Buffer;
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    trimValues: true,
  });

  constructor(
    private readonly token: string,
    encodingAESKey: string,
    private readonly appId: string
  ) {
    const key = Buffer.from(
      (encodingAESKey || '').length === 43
        ? `${encodingAESKey}=`
        : encodingAESKey || '',
      'base64'
    );
    if (key.length !== 32) {
      throw new Error(
        'WECHAT_COMPONENT_AES_KEY 无效：需要 43 位 EncodingAESKey'
      );
    }
    this.key = key;
    this.iv = key.subarray(0, 16);
  }

  verifySignature(
    signature: string,
    timestamp: string,
    nonce: string,
    encrypt?: string
  ): boolean {
    if (!signature || !timestamp || !nonce) {
      return false;
    }

    const parts = [this.token, timestamp, nonce];
    if (encrypt) {
      parts.push(encrypt);
    }

    const expected = createHash('sha1')
      .update(parts.sort().join(''))
      .digest('hex');

    return expected === signature;
  }

  decrypt(encrypted: string): string {
    if (!encrypted) {
      throw new Error('微信回调缺少 Encrypt 内容');
    }

    const decipher = createDecipheriv('aes-256-cbc', this.key, this.iv);
    decipher.setAutoPadding(false);

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64')),
      decipher.final(),
    ]);

    // WeChat 用 PKCS#7（块大小 32）补齐，但节点侧关闭自动去填充后需手动处理。
    const pad = decrypted[decrypted.length - 1];
    if (pad < 1 || pad > 32) {
      throw new Error('微信回调密文填充无效');
    }

    const content = decrypted.subarray(0, decrypted.length - pad);
    if (content.length < 20) {
      throw new Error('微信回调明文长度无效');
    }

    const msgLength = content.readUInt32BE(16);
    if (msgLength < 0 || content.length < 20 + msgLength) {
      throw new Error('微信回调明文消息长度无效');
    }

    const message = content.subarray(20, 20 + msgLength).toString('utf8');
    const fromAppId = content.subarray(20 + msgLength).toString('utf8');

    if (this.appId && fromAppId !== this.appId) {
      throw new Error('微信回调 AppId 不匹配');
    }

    return message;
  }

  parseXml(xml: string): any {
    const parsed = this.parser.parse(xml || '');
    return parsed?.xml || {};
  }
}
