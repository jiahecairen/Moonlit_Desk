'use strict';
const { spawn } = require('node:child_process');

function command(executable, args, cwd, timeout = 180000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env: {
      ...process.env, PATH: '/opt/homebrew/bin:/usr/local/bin:' + (process.env.PATH || ''),
      GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1'
    } });
    let output = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeout);
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-16000); });
    child.stderr.on('data', chunk => { output = (output + chunk).slice(-16000); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(output.trim());
      else reject(new Error(timedOut ? '操作超时，请检查网络后重试。' : output.trim() || '命令执行失败。'));
    });
  });
}
module.exports = { command };
