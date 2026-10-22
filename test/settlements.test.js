import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBalances, calculateSettlements } from '../src/settlements.js';

test('settles a cost that cannot be split evenly', () => {
  const people = ['a', 'b', 'c'].map((id) => ({ id, name: id }));
  const expenses = [{ payerId: 'a', amount: 100, participantIds: ['a', 'b', 'c'] }];
  const balances = calculateBalances(people, expenses);
  assert.deepEqual(balances.map((person) => person.balance), [66, -33, -33]);
  assert.deepEqual(calculateSettlements(balances), [
    { fromId: 'b', toId: 'a', amount: 33 },
    { fromId: 'c', toId: 'a', amount: 33 },
  ]);
});

test('settles multiple expenses with different participants', () => {
  const people = ['a', 'b', 'c'].map((id) => ({ id, name: id }));
  const expenses = [
    { payerId: 'a', amount: 120, participantIds: ['a', 'b', 'c'] },
    { payerId: 'b', amount: 50, participantIds: ['b', 'c'] },
  ];
  const balances = calculateBalances(people, expenses);
  assert.deepEqual(balances.map((person) => person.balance), [80, -15, -65]);
  assert.deepEqual(calculateSettlements(balances), [
    { fromId: 'c', toId: 'a', amount: 65 },
    { fromId: 'b', toId: 'a', amount: 15 },
  ]);
});

test('recorded payments reduce balances and remaining suggestions', () => {
  const people = ['a', 'b', 'c'].map((id) => ({ id, name: id }));
  const expenses = [{ payerId: 'a', amount: 90, participantIds: ['a', 'b', 'c'] }];
  const recorded = [{ fromId: 'b', toId: 'a', amount: 20 }];
  const balances = calculateBalances(people, expenses, recorded);
  assert.deepEqual(balances.map((person) => person.balance), [40, -10, -30]);
  assert.deepEqual(calculateSettlements(balances), [
    { fromId: 'c', toId: 'a', amount: 30 },
    { fromId: 'b', toId: 'a', amount: 10 },
  ]);
});
