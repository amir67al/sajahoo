export const defaultTickerMessages = [
  'ثبت منظم هزینه‌ها، تسویهٔ حساب را ساده‌تر می‌کند.',
  'هزینه‌های امروز را همان امروز ثبت کنید.',
  'یک حساب روشن، همکاری را آسان‌تر می‌کند.',
  'پیش از تسویه، مبلغ و طرف مقابل را بررسی کنید.',
  'گزارش هر روز در بخش هزینه‌ها در دسترس است.',
];

export function pickTickerMessage(messages, random = Math.random) {
  if (!messages.length) return '';
  return messages[Math.floor(random() * messages.length)];
}

export function makeFileCopy(data, title) {
  return {
    version: 1,
    title: title.trim(),
    people: data.people.map((person) => ({ ...person })),
    items: data.items.map((item) => ({ ...item })),
    expenses: [],
    settlements: [],
    tickerMessages: [...data.tickerMessages],
  };
}
