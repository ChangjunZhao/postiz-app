import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MediaDto } from '@gitroom/nestjs-libraries/dtos/media/media.dto';

/**
 * 微信公众号图文设置。
 *
 * 微信草稿接口的限制：
 * - title ≤ 32 字
 * - author ≤ 16 字
 * - digest ≤ 120 字
 * - 封面必须是一张永久素材（由 provider 上传后换 thumb_media_id）
 */
export class WechatSettingsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  author?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  digest?: string;

  /**
   * publish = 发布到公众号历史消息（默认，不推送）
   * mass    = 群发给全部粉丝（消耗群发配额，需要「群发与通知」权限集 7）
   */
  @IsOptional()
  @IsIn(['publish', 'mass'])
  publish_mode?: 'publish' | 'mass';

  /** 可选：单独指定封面；不填时使用第一张媒体图。 */
  @IsOptional()
  @ValidateNested()
  @Type(() => MediaDto)
  thumb?: MediaDto;

  @IsOptional()
  @IsBoolean()
  need_open_comment?: boolean;

  @IsOptional()
  @IsBoolean()
  only_fans_can_comment?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  content_source_url?: string;
}
