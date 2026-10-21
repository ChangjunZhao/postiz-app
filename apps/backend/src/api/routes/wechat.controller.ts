import {
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { wechatComponentService } from '@gitroom/nestjs-libraries/integrations/wechat/wechat.component.service';

/**
 * 微信开放平台第三方平台的短回调路径。
 *
 * 开放平台的「消息与事件接收 URL」要求包含 $APPID$ 占位符，且输入框长度
 * 有限；长路径 /api/integrations/wechat/component/$APPID$ 放不下。这里提供：
 * - 授权事件接收 URL: https://<domain>/api/wx/auth
 * - 消息与事件接收 URL: https://<domain>/api/wx/$APPID$
 */
@ApiTags('WeChat')
@Controller('/wx')
export class WechatController {
  @Get('/auth')
  async authVerify(@Query() query: any, @Res() res: any) {
    try {
      if (
        !wechatComponentService.verifyUrl(
          query.signature,
          query.timestamp,
          query.nonce
        )
      ) {
        return res.status(403).send('invalid signature');
      }

      return res.send(query.echostr || '');
    } catch {
      return res.status(403).send('invalid');
    }
  }

  @Post('/auth')
  @HttpCode(200)
  async authEvent(@Query() query: any, @Req() req: any, @Res() res: any) {
    try {
      const rawXml =
        req.rawBody?.toString('utf8') ||
        (typeof req.body === 'string' ? req.body : '');
      await wechatComponentService.handleEvent(rawXml, query);
      return res.send('success');
    } catch (err) {
      console.error('WeChat component event failed', err);
      return res.status(403).send('invalid');
    }
  }

  @Get('/:appid')
  async authorizerVerify(@Query() query: any, @Res() res: any) {
    try {
      if (
        !wechatComponentService.verifyUrl(
          query.signature,
          query.timestamp,
          query.nonce
        )
      ) {
        return res.status(403).send('invalid signature');
      }

      return res.send(query.echostr || '');
    } catch {
      return res.status(403).send('invalid');
    }
  }

  @Post('/:appid')
  @HttpCode(200)
  async authorizerEvent(@Res() res: any) {
    // Authorized-account messages are intentionally ignored. Publishing uses
    // the component API directly; acknowledge so WeChat does not retry.
    return res.send('success');
  }
}
