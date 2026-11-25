'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AutoSaveQueue } = require('./autosave');

test('autosave coalesces typing and serializes newer changes during a write', async () => {
  const values = [], states = [];
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const queue = new AutoSaveQueue(async value => {
    values.push(value);
    if (value === 'latest before write') { entered(); await new Promise(resolve => { release = resolve; }); }
  }, {delay:10000,onState:state=>states.push(state)});
  queue.schedule('first keystroke'); queue.schedule('latest before write');
  const writing = queue.flush(); await started;
  queue.schedule('edited during write'); release();
  assert.equal(await writing,true);
  assert.deepEqual(values,['latest before write','edited during write']);
  assert.equal(states.at(-1),'saved');
});
test('autosave reports failures, resumes on a new edit, and cancels old-project drafts', async () => {
  const values = [], states = [];
  const queue = new AutoSaveQueue(async value => {
    if (value === 'broken') throw new Error('write failed');
    if (value === 'incomplete') return false;
    values.push(value);
  },{delay:10000,onState:(state,error)=>states.push([state,error?.message])});
  queue.schedule('broken'); assert.equal(await queue.flush(),false);
  assert.deepEqual(states.at(-1),['error','write failed']);
  queue.schedule('incomplete'); assert.equal(await queue.flush(),false);
  assert.equal(states.at(-1)[0],'waiting');
  queue.schedule('valid'); assert.equal(await queue.flush(),true);
  queue.schedule('old-project'); queue.cancelPending(); await queue.flush();
  assert.deepEqual(values,['valid']);
});
