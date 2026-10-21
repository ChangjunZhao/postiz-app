'use client';

import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { WechatSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/wechat.settings.dto';
import { Input } from '@gitroom/react/form/input';
import { Textarea } from '@gitroom/react/form/textarea';
import { Checkbox } from '@gitroom/react/form/checkbox';
import { Select } from '@gitroom/react/form/select';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';

const WechatSettings = () => {
  const form = useSettings();
  return (
    <div className="flex flex-col gap-[10px]">
      <Input label="文章标题" name="title" maxLength={32} />
      <Input label="作者" name="author" maxLength={16} />
      <Textarea label="摘要" name="digest" maxLength={120} />
      <Select
        label="发布方式"
        {...form.register('publish_mode', { value: 'publish' })}
      >
        <option value="publish">发布（不推送，进公众号历史消息）</option>
        <option value="mass">群发（推送给全部粉丝，消耗群发次数）</option>
      </Select>
      <p className="text-[12px] text-textColor opacity-60">
        群发会消耗公众号群发配额（订阅号每天 1 次，服务号每月 4
        次），且会推送给全部粉丝，请谨慎选择。
      </p>
      <div className="flex flex-wrap gap-[16px]">
        <Checkbox name="need_open_comment" label="开启留言" />
        <Checkbox name="only_fans_can_comment" label="仅粉丝可留言" />
      </div>
      <p className="text-[12px] text-textColor opacity-60">
        第一张图片会作为封面；正文图片会自动上传到微信素材库，外链图片会被微信过滤。
      </p>
    </div>
  );
};

export default withProvider({
  postComment: PostComment.COMMENT,
  comments: false,
  minimumCharacters: [],
  SettingsComponent: WechatSettings,
  CustomPreviewComponent: undefined,
  dto: WechatSettingsDto,
  maximumCharacters: 20000,
});
