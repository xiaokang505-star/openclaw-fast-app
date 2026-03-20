import * as os from 'os';

export type LocalUserContext = {
  username: string;
  realName?: string;
  homeDir: string;
  hostName: string;
  platform: NodeJS.Platform;
  arch: string;
  locale: string;
  timezone: string;
};

export function getLocalUserContext(): LocalUserContext {
  const info = os.userInfo();
  const locale = Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return {
    username: info.username,
    realName: undefined,
    homeDir: os.homedir(),
    hostName: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    locale,
    timezone,
  };
}

export function buildLocalUserContextPrompt(ctx: LocalUserContext): string {
  return [
    '你在本机桌面代理环境中运行。以下是当前设备与用户上下文：',
    `- username: ${ctx.username}`,
    `- homeDir: ${ctx.homeDir}`,
    `- hostName: ${ctx.hostName}`,
    `- platform: ${ctx.platform}`,
    `- arch: ${ctx.arch}`,
    `- locale: ${ctx.locale}`,
    `- timezone: ${ctx.timezone}`,
    '重要规则：',
    '- 不要使用占位符（如 @username / your_user_id）当作消息目标。',
    '- 如果用户要求发消息但未明确目标，请先追问目标（用户名/用户ID/会话ID）。',
  ].join('\n');
}
