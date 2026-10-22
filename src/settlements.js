export function calculateBalances(people, expenses, recordedSettlements = []) {
  const balances = new Map(people.map((person) => [person.id, { ...person, paid: 0, share: 0, balance: 0 }]));

  for (const expense of expenses) {
    const payer = balances.get(expense.payerId);
    if (payer) payer.paid += expense.amount;

    const participants = [...new Set(expense.participantIds)].filter((personId) => balances.has(personId));
    if (!participants.length) continue;
    const baseShare = Math.floor(expense.amount / participants.length);
    const remainder = expense.amount % participants.length;
    participants.forEach((personId, index) => {
      balances.get(personId).share += baseShare + (index < remainder ? 1 : 0);
    });
  }

  for (const settlement of recordedSettlements) {
    const sender = balances.get(settlement.fromId);
    const recipient = balances.get(settlement.toId);
    if (sender && recipient) {
      sender.paid += settlement.amount;
      recipient.paid -= settlement.amount;
    }
  }

  return [...balances.values()].map((person) => ({ ...person, balance: person.paid - person.share }));
}

export function calculateSettlements(balances) {
  const debtors = balances.filter((person) => person.balance < 0).map((person) => ({ id: person.id, remaining: -person.balance }));
  const creditors = balances.filter((person) => person.balance > 0).map((person) => ({ id: person.id, remaining: person.balance }));
  debtors.sort((a, b) => b.remaining - a.remaining);
  creditors.sort((a, b) => b.remaining - a.remaining);

  const settlements = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = Math.min(debtor.remaining, creditor.remaining);
    settlements.push({ fromId: debtor.id, toId: creditor.id, amount });
    debtor.remaining -= amount;
    creditor.remaining -= amount;
    if (debtor.remaining === 0) debtorIndex++;
    if (creditor.remaining === 0) creditorIndex++;
  }
  return settlements;
}
