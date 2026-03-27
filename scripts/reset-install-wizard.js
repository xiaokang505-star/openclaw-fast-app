#!/usr/bin/env node
/**
 * 重置「安装向导已完成」状态，下次启动应用会进入首页安装流程。
 *
 * 原理：Electron 将设置存在 userData/settings.json，其中 wizardCompleted === true 时会跳过向导直进对话。
 *
 * 用法：
 *   node scripts/reset-install-wizard.js
 *   npm run reset-wizard
 *
 * 若自定义了数据目录，可指定：
 *   OPENCLAW_SETUP_USER_DATA=/path/to/dir node scripts/reset-install-wizard.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const pkg = require('../package.json');
const APP_NAME = pkg.name || 'openclaw-setup';

function defaultUserDataDir() {
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', APP_NAME);
    case 'win32':
      return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), APP_NAME);
    default:
      return path.join(home, '.config', APP_NAME);
  }
}

function main() {
  const root = process.env.OPENCLAW_SETUP_USER_DATA || defaultUserDataDir();
  const settingsPath = path.join(root, 'settings.json');

  console.log('数据目录:', root);
  console.log('settings.json:', settingsPath);

  if (!fs.existsSync(settingsPath)) {
    console.log('未找到 settings.json（尚无保存的设置）。下次启动将已是「未完成向导」状态。');
    return;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (e) {
    console.error('读取 settings.json 失败:', e.message);
    process.exit(1);
  }

  const had = data.wizardCompleted === true;
  delete data.wizardCompleted;

  fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), 'utf8');
  console.log(had ? '已清除 wizardCompleted，下次启动将显示安装向导首页。' : 'settings 中本就没有 wizardCompleted；已写回文件（无变更需求）。');
}

main();
