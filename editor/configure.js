'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { settings, settingsFile } = require('./project');
const selected = process.argv[2];
if (!selected) {
  console.error('Usage: npm run configure -- /path/to/hexo-blog');
  process.exitCode = 1;
} else {
  const root = path.resolve(selected);
  if (!fs.existsSync(path.join(root, '_config.yml')) || !fs.existsSync(path.join(root, 'package.json'))) {
    throw new Error('Choose a Hexo directory containing _config.yml and package.json.');
  }
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  const temp = settingsFile + '.tmp';
  const config = settings();
  if (config.projectPath !== root) delete config.articleBackupPath;
  config.projectPath = root;
  fs.writeFileSync(temp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temp, settingsFile);
  console.log('Hexo project configured. Run npm start to open the editor.');
}
