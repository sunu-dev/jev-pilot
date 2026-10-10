import test from 'node:test';
import assert from 'node:assert/strict';
import { trailingOverride } from '../src/override.mjs';

test('explicit trailing model and effort commands work in Korean, English, Japanese and Chinese', () => {
  for (const text of ['화면을 개선해줘. 솔 엑스하이로 해', '화면을 개선해줘. 솔 xhigh로해', 'Improve the page. Use Sol xhigh', '画面を改善してください。ソル xhighでお願いします', '改进页面。请用Sol xhigh']) {
    assert.deepEqual(trailingOverride(text), { model: 'sol', effort: 'xhigh' }, text);
  }
  for (const text of ['아스트라로해', 'use Astra', 'アストラでお願いします', '使用阿斯特拉']) assert.deepEqual(trailingOverride(text), { model: 'astra', effort: null }, text);
  for (const text of ['루나로 해', '루니로해', 'Use Luna please', 'ルナでお願い', '用露娜']) assert.deepEqual(trailingOverride(text), { model: 'luna', effort: null }, text);
  assert.deepEqual(trailingOverride('아스트라 미디움으로 해'), { model: 'astra', effort: 'medium' });
  assert.deepEqual(trailingOverride('用Sol 极高'), { model: 'sol', effort: 'xhigh' });
});
test('quoted examples, fenced code, mentions and ordinary words are not model commands', () => {
  for (const text of ['설명해줘 "아스트라로해"', '끝에 솔로해 이렇게 쓰면 되나?', '콘솔로해', 'Use Sol to fix the bug', 'Astra', '```\nUse Astra', '~~~text\n아스트라로해', 'Example: `Use Astra`']) assert.equal(trailingOverride(text), null, text);
});
