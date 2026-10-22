import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTickerMessages, makeFileCopy, pickTickerMessage } from '../src/file-data.js';

test('a file copy keeps people and items but clears transactions', () => {
  const original = {
    title: 'قدیمی',
    people: [{ id: 'p1', name: 'علی' }],
    items: [{ id: 'i1', name: 'چای' }],
    expenses: [{ id: 'e1' }],
    settlements: [{ id: 's1' }],
    tickerMessages: [...defaultTickerMessages],
  };
  const copy = makeFileCopy(original, '  جدید  ');
  assert.equal(copy.title, 'جدید');
  assert.deepEqual(copy.people, original.people);
  assert.deepEqual(copy.items, original.items);
  assert.notStrictEqual(copy.people[0], original.people[0]);
  assert.deepEqual(copy.expenses, []);
  assert.deepEqual(copy.settlements, []);
  assert.deepEqual(copy.tickerMessages, original.tickerMessages);
  assert.equal(original.expenses.length, 1);
});

test('ticker selects one message from the file array', () => {
  assert.equal(pickTickerMessage(['اول', 'دوم'], () => 0), 'اول');
  assert.equal(pickTickerMessage(['اول', 'دوم'], () => 0.99), 'دوم');
});
