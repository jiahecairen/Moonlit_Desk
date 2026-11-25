'use strict';
const Hexo = require(require.resolve('hexo', { paths: [process.argv[2]] }));
const root = process.argv[2];
const hexo = new Hexo(root, { silent: true });
(async () => {
  await hexo.init();
  await hexo.call('generate', { force: true, bail: true });
  await hexo.exit();
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
