import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { toGregorian, toJalaali, isValidJalaaliDate } from 'jalaali-js';
import { calculateBalances, calculateSettlements } from './settlements.js';
import { defaultTickerMessages, makeFileCopy, pickTickerMessage } from './file-data.js';

const emptyData = () => ({ version: 1, title: '', people: [], items: [], expenses: [], settlements: [], tickerMessages: [...defaultTickerMessages] });
const money = (value) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(Math.round(value));
const date = (value) => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value));
const dateInput = (value) => {
  const { jy, jm, jd } = toJalaali(new Date(value));
  return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
};
const latinDigits = (value) => value.replace(/[۰-۹٠-٩]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit) >= 0 ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit) : '٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
const parseJalaliDate = (value) => {
  const match = /^([0-9]{4})\/([0-9]{1,2})\/([0-9]{1,2})$/.exec(latinDigits(value.trim()));
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  if (!isValidJalaaliDate(year, month, day)) return null;
  const { gy, gm, gd } = toGregorian(year, month, day);
  return new Date(gy, gm - 1, gd, 12).toISOString();
};
const id = () => crypto.randomUUID();

function defaultFileStore(action, value) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('office-expenses-settings', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('settings', action === 'get' ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('settings');
      const operation = action === 'get' ? store.get('defaultFile') : action === 'set' ? store.put(value, 'defaultFile') : store.delete('defaultFile');
      let result;
      operation.onsuccess = () => { result = operation.result; };
      operation.onerror = () => reject(operation.error);
      transaction.oncomplete = () => { db.close(); resolve(result); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  });
}

function validateData(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.people) || !Array.isArray(value.items) || !Array.isArray(value.expenses)) {
    throw new Error('ساختار فایل JSON معتبر نیست.');
  }
  const validNames = (list) => list.every((entry) => typeof entry.id === 'string' && typeof entry.name === 'string');
  if (!validNames(value.people) || !validNames(value.items) || !value.expenses.every((entry) =>
    typeof entry.id === 'string' && typeof entry.itemId === 'string' && typeof entry.payerId === 'string' &&
    Number.isSafeInteger(entry.amount) && entry.amount > 0 &&
    (entry.quantity === undefined || (Number.isSafeInteger(entry.quantity) && entry.quantity > 0)) && Array.isArray(entry.participantIds) &&
    entry.participantIds.length > 0 && entry.participantIds.every((personId) => typeof personId === 'string') &&
    typeof entry.createdAt === 'string')) {
    throw new Error('اطلاعات داخل فایل JSON معتبر نیست.');
  }
  if (value.settlements !== undefined && (!Array.isArray(value.settlements) || !value.settlements.every((entry) =>
    typeof entry.id === 'string' && typeof entry.fromId === 'string' && typeof entry.toId === 'string' &&
    Number.isSafeInteger(entry.amount) && entry.amount > 0 && typeof entry.createdAt === 'string'))) {
    throw new Error('اطلاعات تسویه‌ها در فایل JSON معتبر نیست.');
  }
  if (value.title !== undefined && (typeof value.title !== 'string' || value.title.length > 80)) {
    throw new Error('عنوان فایل JSON معتبر نیست.');
  }
  if (value.tickerMessages !== undefined && (!Array.isArray(value.tickerMessages) || !value.tickerMessages.length || !value.tickerMessages.every((message) => typeof message === 'string' && message.trim()))) {
    throw new Error('آرایهٔ جمله‌های فایل JSON معتبر نیست.');
  }
  return { ...value, title: value.title ?? '', settlements: value.settlements ?? [], tickerMessages: value.tickerMessages ?? [...defaultTickerMessages] };
}

function App() {
  const [data, setData] = useState(emptyData);
  const [fileHandle, setFileHandle] = useState(null);
  const [fileName, setFileName] = useState('');
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneTitle, setCloneTitle] = useState('');
  const [tickerText, setTickerText] = useState('');
  const [tickerRun, setTickerRun] = useState(0);
  const tickerTimer = React.useRef(null);
  const [saveStatus, setSaveStatus] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [defaultHandle, setDefaultHandle] = useState(null);
  const [isDefault, setIsDefault] = useState(false);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [restoringDefault, setRestoringDefault] = useState(true);
  const [theme, setTheme] = useState(() => localStorage.getItem('expense-theme') === 'dark' ? 'dark' : 'light');

  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('expense-theme', theme);
  }, [theme]);

  React.useEffect(() => () => clearTimeout(tickerTimer.current), []);

  function showTicker(messages) {
    clearTimeout(tickerTimer.current);
    setTickerRun((run) => run + 1);
    setTickerText(pickTickerMessage(messages));
    tickerTimer.current = setTimeout(() => setTickerText(''), 10000);
  }

  const supported = typeof window.showOpenFilePicker === 'function' && typeof window.showSaveFilePicker === 'function';

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const handle = await defaultFileStore('get');
        if (cancelled || !handle) return;
        setDefaultHandle(handle);
        const permission = await handle.queryPermission({ mode: 'readwrite' });
        if (cancelled) return;
        if (permission === 'granted') {
          await activateFile(handle, true);
        } else {
          setNeedsPermission(true);
        }
      } catch (cause) {
        if (!cancelled) setError(`فایل پیش‌فرض باز نشد: ${cause.message}`);
      } finally {
        if (!cancelled) setRestoringDefault(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function activateFile(handle, fromDefault = false) {
    const file = await handle.getFile();
    const raw = JSON.parse(await file.text());
    const parsed = validateData(raw);
    let messagesStored = Array.isArray(raw.tickerMessages);
    if (!messagesStored) {
      try {
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(parsed, null, 2));
        await writable.close();
        messagesStored = true;
      } catch (cause) {
        setError(`جمله‌ها به فایل قدیمی اضافه نشدند: ${cause.message}`);
      }
    }
    setData(parsed);
    setFileHandle(handle);
    setFileName(handle.name);
    if (messagesStored) showTicker(parsed.tickerMessages);
    else { clearTimeout(tickerTimer.current); setTickerText(''); }
    setSaveStatus('آماده');
    setNeedsPermission(false);
    setEditing(null);
    setTitleEditing(false);
    setIsDefault(fromDefault || (defaultHandle ? await handle.isSameEntry(defaultHandle) : false));
  }

  async function reconnectDefault() {
    try {
      setError('');
      if (await defaultHandle.requestPermission({ mode: 'readwrite' }) !== 'granted') return;
      await activateFile(defaultHandle, true);
    } catch (cause) {
      setError(`فایل پیش‌فرض باز نشد: ${cause.message}`);
    }
  }

  async function setAsDefault() {
    try {
      await defaultFileStore('set', fileHandle);
      setDefaultHandle(fileHandle);
      setIsDefault(true);
      setError('');
    } catch (cause) {
      setError(`انتخاب فایل پیش‌فرض انجام نشد: ${cause.message}`);
    }
  }

  async function clearDefault() {
    try {
      await defaultFileStore('delete');
      setDefaultHandle(null);
      setIsDefault(false);
      setNeedsPermission(false);
      setError('');
    } catch (cause) {
      setError(`حذف فایل پیش‌فرض انجام نشد: ${cause.message}`);
    }
  }

  async function openFile() {
    try {
      setError('');
      const [handle] = await window.showOpenFilePicker({ types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }], multiple: false });
      await activateFile(handle);
    } catch (cause) {
      if (cause.name !== 'AbortError') setError(cause instanceof SyntaxError ? 'فایل انتخاب‌شده JSON معتبر نیست.' : cause.message);
    }
  }

  async function createFile() {
    try {
      setError('');
      const handle = await window.showSaveFilePicker({ suggestedName: 'office-expenses.json', types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] });
      const initial = emptyData();
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(initial, null, 2));
      await writable.close();
      setData(initial);
      setFileHandle(handle);
      setFileName(handle.name);
      showTicker(initial.tickerMessages);
      setSaveStatus('ذخیره شد');
      setEditing(null);
      setTitleEditing(false);
      setIsDefault(false);
    } catch (cause) {
      if (cause.name !== 'AbortError') setError(cause.message);
    }
  }

  async function createCopy(event) {
    event.preventDefault();
    const title = cloneTitle.trim();
    if (!title || title.length > 80) return setError('برای فایل جدید عنوانی با حداکثر ۸۰ نویسه وارد کنید.');
    setError('');
    setBusy(true);
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: `${fileName.replace(/\.json$/i, '')}-copy.json`, types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] });
      if (await handle.isSameEntry(fileHandle)) throw new Error('برای کپی، نام یا مسیر متفاوتی از فایل فعلی انتخاب کنید.');
      const copy = makeFileCopy(data, title);
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(copy, null, 2));
      await writable.close();
      setData(copy);
      setFileHandle(handle);
      setFileName(handle.name);
      setIsDefault(false);
      setNeedsPermission(false);
      setSaveStatus('ذخیره شد');
      showTicker(copy.tickerMessages);
      setTitleEditing(false);
      setCloneOpen(false);
      setTab('overview');
    } catch (cause) {
      if (cause.name !== 'AbortError') setError(`ساخت کپی انجام نشد: ${cause.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function commit(next) {
    if (!fileHandle || busy) return false;
    setBusy(true);
    setSaveStatus('در حال ذخیره…');
    setError('');
    try {
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(next, null, 2));
      await writable.close();
      setData(next);
      setSaveStatus('ذخیره شد');
      setEditing(null);
      return true;
    } catch (cause) {
      setSaveStatus('ذخیره نشد');
      setError(`ذخیرهٔ فایل انجام نشد: ${cause.message}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveTitle(event) {
    event.preventDefault();
    const title = titleDraft.trim();
    if (title.length > 80) return setError('عنوان باید حداکثر ۸۰ نویسه باشد.');
    if (await commit({ ...data, title })) setTitleEditing(false);
  }

  const peopleById = Object.fromEntries(data.people.map((person) => [person.id, person]));
  const itemsById = Object.fromEntries(data.items.map((item) => [item.id, item]));
  const balances = useMemo(() => calculateBalances(data.people, data.expenses, data.settlements), [data.people, data.expenses, data.settlements]);
  const suggestedTransfers = useMemo(() => calculateSettlements(balances), [balances]);
  const total = data.expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const itemTotals = useMemo(() => {
    const totals = new Map(data.items.map((item) => [item.id, { ...item, total: 0, count: 0 }]));
    for (const expense of data.expenses) {
      const item = totals.get(expense.itemId);
      if (item) { item.total += expense.amount; item.count += expense.quantity ?? 1; }
    }
    return [...totals.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'fa'));
  }, [data.items, data.expenses]);
  const latest = [...data.expenses].reverse().slice(0, 5);
  const expenseGroups = useMemo(() => {
    const groups = new Map();
    for (const expense of [...data.expenses].reverse()) {
      const day = dateInput(expense.createdAt);
      if (!groups.has(day)) groups.set(day, { day, total: 0, expenses: [] });
      const group = groups.get(day);
      group.total += expense.amount;
      group.expenses.push(expense);
    }
    return [...groups.values()].sort((a, b) => b.day.localeCompare(a.day));
  }, [data.expenses]);

  function startPerson(person) {
    setEditing({ type: 'person', id: person?.id ?? null });
    setForm({ name: person?.name ?? '' });
  }
  function startItem(item) {
    setEditing({ type: 'item', id: item?.id ?? null });
    setForm({ name: item?.name ?? '' });
  }
  function startExpense(expense) {
    setEditing({ type: 'expense', id: expense?.id ?? null });
    setForm(expense ? { itemId: expense.itemId, payerId: expense.payerId, quantity: String(expense.quantity ?? 1), amount: String(expense.amount), date: dateInput(expense.createdAt), participantIds: [...expense.participantIds] } : {
      itemId: data.items[0]?.id ?? '', payerId: data.people[0]?.id ?? '', quantity: '1', amount: '', date: dateInput(new Date()), participantIds: data.people.map((person) => person.id),
    });
  }

  function startSettlement(transfer, person) {
    const suggested = transfer ?? suggestedTransfers.find((entry) => entry.fromId === person?.id || entry.toId === person?.id);
    if (!suggested) return;
    setError('');
    setEditing({ type: 'settlement', id: null });
    setForm({ fromId: suggested.fromId, toId: suggested.toId, amount: String(suggested.amount), date: dateInput(new Date()) });
  }

  async function saveNamed(type, event) {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) return setError('نام را وارد کنید.');
    const key = type === 'person' ? 'people' : 'items';
    if (data[key].some((entry) => entry.name.toLocaleLowerCase() === name.toLocaleLowerCase() && entry.id !== editing.id)) return setError('این نام قبلاً ثبت شده است.');
    const list = editing.id ? data[key].map((entry) => entry.id === editing.id ? { ...entry, name } : entry) : [...data[key], { id: id(), name }];
    await commit({ ...data, [key]: list });
  }

  async function saveExpense(event) {
    event.preventDefault();
    const amount = Number(form.amount);
    const quantity = Number(form.quantity);
    const createdAt = parseJalaliDate(form.date);
    if (!itemsById[form.itemId] || !peopleById[form.payerId]) return setError('کالا و پرداخت‌کننده را مشخص کنید.');
    if (!Number.isSafeInteger(amount) || amount <= 0) return setError('مبلغ باید عدد صحیح و بزرگ‌تر از صفر باشد.');
    if (!Number.isSafeInteger(quantity) || quantity <= 0) return setError('تعداد باید عدد صحیح و بزرگ‌تر از صفر باشد.');
    if (!createdAt) return setError('تاریخ شمسی معتبر را به شکل ۱۴۰۵/۰۷/۱۳ وارد کنید.');
    if (!form.participantIds.length) return setError('حداقل یک نفر را در هزینه شریک کنید.');
    const expense = { id: editing.id ?? id(), itemId: form.itemId, payerId: form.payerId, quantity, amount, participantIds: form.participantIds, createdAt };
    const expenses = editing.id ? data.expenses.map((entry) => entry.id === editing.id ? expense : entry) : [...data.expenses, expense];
    await commit({ ...data, expenses });
  }

  async function saveSettlement(event) {
    event.preventDefault();
    const amount = Number(form.amount);
    const createdAt = parseJalaliDate(form.date);
    const debtor = balances.find((person) => person.id === form.fromId);
    const creditor = balances.find((person) => person.id === form.toId);
    if (!debtor || !creditor || debtor.id === creditor.id) return setError('پرداخت‌کننده و دریافت‌کننده را درست انتخاب کنید.');
    if (!Number.isSafeInteger(amount) || amount <= 0) return setError('مبلغ تسویه باید عدد صحیح و بزرگ‌تر از صفر باشد.');
    if (debtor.balance >= 0 || creditor.balance <= 0 || amount > Math.min(-debtor.balance, creditor.balance)) return setError('مبلغ تسویه از ماندهٔ قابل پرداخت بیشتر است.');
    if (!createdAt) return setError('تاریخ شمسی معتبر را وارد کنید.');
    const settlement = { id: id(), fromId: debtor.id, toId: creditor.id, amount, createdAt };
    await commit({ ...data, settlements: [...data.settlements, settlement] });
  }

  async function remove(type, entry) {
    const label = type === 'expense' ? 'این هزینه' : type === 'settlement' ? 'این تسویه' : `«${entry.name}»`;
    if (!window.confirm(`آیا از حذف ${label} مطمئن هستید؟`)) return;
    if (type === 'person' && data.expenses.some((expense) => expense.payerId === entry.id || expense.participantIds.includes(entry.id))) return setError('این نفر در هزینه‌ها استفاده شده است. ابتدا هزینه‌های مربوط را حذف یا ویرایش کنید.');
    if (type === 'person' && data.settlements.some((settlement) => settlement.fromId === entry.id || settlement.toId === entry.id)) return setError('این نفر در تسویه‌ها استفاده شده است. ابتدا تسویه‌های مربوط را حذف کنید.');
    if (type === 'item' && data.expenses.some((expense) => expense.itemId === entry.id)) return setError('این کالا در هزینه‌ها استفاده شده است. ابتدا هزینه‌های مربوط را حذف یا ویرایش کنید.');
    const key = type === 'person' ? 'people' : type === 'item' ? 'items' : type === 'settlement' ? 'settlements' : 'expenses';
    await commit({ ...data, [key]: data[key].filter((candidate) => candidate.id !== entry.id) });
  }

  const emptyMessage = !fileHandle && !restoringDefault ? 'برای شروع، یک فایل JSON جدید بسازید یا فایل قبلی را باز کنید.' : '';

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><svg viewBox="0 0 32 24" width="29" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 9h6l2 2h4l2-2h10v5H14l-2 2H8l-2-2H2V9Z" /><path d="M26 10h4v3h-4M19 9V6h4v3M10 16l-2 5h4l2-5M18 14l2 6h3l-2-6" /></svg></span><div><strong>سامانه جامع حسابداری وظیفه</strong><small>حساب مشترک، ساده و روشن</small></div></div>
      <div className="file-actions"><button className="button button-light theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={theme === 'light' ? 'فعال کردن تم تیره' : 'فعال کردن تم روشن'} title={theme === 'light' ? 'تم تیره' : 'تم روشن'}>{theme === 'light' ? '☾ تم تیره' : '☀ تم روشن'}</button><span className="file-pill"><span className={`status-dot ${fileHandle ? 'active' : ''}`}></span>{fileHandle ? <><bdi>{fileName}</bdi><span className="save-status"> · {saveStatus}</span></> : 'فایلی باز نیست'}</span><button className="button button-light" onClick={openFile} disabled={!supported || busy}>باز کردن فایل</button><button className="button button-light" onClick={() => { setCloneTitle(''); setCloneOpen(true); setError(''); }} disabled={!fileHandle || busy}>کپی از فایل فعلی</button><button className="button button-dark" onClick={createFile} disabled={!supported || busy}>+ فایل جدید</button></div>
    </header>

    <main className="container">
      {!supported && <div className="alert">مرورگر شما دسترسی مستقیم به فایل را پشتیبانی نمی‌کند. فایل برنامه را با نسخهٔ جدید Chrome یا Edge باز کنید.</div>}
      {error && <div className="alert" role="alert">{error}<button aria-label="بستن پیام" onClick={() => setError('')}>×</button></div>}
      {restoringDefault && <div className="welcome"><p>در حال بررسی فایل پیش‌فرض…</p></div>}
      {emptyMessage && <div className="welcome"><div className="welcome-icon">▤</div><h2>{needsPermission ? 'فایل پیش‌فرض آماده است' : 'از یک فایل ساده شروع کنید'}</h2><p>{needsPermission ? `برای دسترسی دوباره به «${defaultHandle.name}» اجازهٔ مرورگر را تأیید کنید.` : emptyMessage}</p><div className="welcome-actions">{needsPermission && <button className="button button-dark" onClick={reconnectDefault}>اتصال به فایل پیش‌فرض</button>}<button className="button button-light" onClick={createFile} disabled={!supported}>ساخت فایل جدید</button><button className="button button-light" onClick={openFile} disabled={!supported}>باز کردن فایل موجود</button>{needsPermission && <button className="button button-light" onClick={clearDefault}>حذف پیش‌فرض</button>}</div></div>}
      {fileHandle && <>
        <div className="file-preference"><div className="file-title">{titleEditing ? <form onSubmit={saveTitle}><input autoFocus maxLength="80" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} placeholder="عنوان فایل" aria-label="عنوان فایل" /><button type="submit" disabled={busy}>ذخیره</button><button type="button" onClick={() => setTitleEditing(false)}>انصراف</button></form> : <button type="button" className="file-title-trigger" onClick={() => { setTitleDraft(data.title); setTitleEditing(true); }} title="برای ویرایش عنوان کلیک کنید">{data.title || 'برای ثبت عنوان کلیک کنید'}</button>}</div><div className="default-file-action"><span>{isDefault ? 'این فایل، پیش‌فرض برنامه است.' : defaultHandle ? `فایل پیش‌فرض: ${defaultHandle.name}` : 'فایل پیش‌فرضی انتخاب نشده است.'}</span>{!isDefault && <button onClick={setAsDefault}>تنظیم فایل فعلی به‌عنوان پیش‌فرض</button>}{isDefault && <button onClick={clearDefault}>حذف فایل پیش‌فرض</button>}</div></div>
        <nav className="tabs" aria-label="بخش‌های برنامه">{[['overview', 'نمای کلی'], ['expenses', 'هزینه‌ها'], ['settlements', 'تسویه‌ها'], ['people', 'نفرات'], ['items', 'کالاها']].map(([key, label]) => <button key={key} className={tab === key ? 'selected' : ''} onClick={() => { setTab(key); setEditing(null); setError(''); }}>{label}</button>)}</nav>
        {tab === 'overview' && <>
          <div className="overview-lead">
            <div className="summary-card primary"><span>مجموع هزینه‌های فایل</span><strong>{money(total)} <small>تومان</small></strong><p>{money(data.expenses.length)} هزینهٔ ثبت‌شده</p></div>
            <section className="panel settlement-panel"><div className="panel-title"><div><h2>پیشنهاد تسویه</h2><p>برای صفر شدن مانده‌ها</p></div></div>{suggestedTransfers.length ? <div className="settlement-list">{suggestedTransfers.map((transfer) => <div className="settlement-row" key={`${transfer.fromId}-${transfer.toId}`}><span><strong>{peopleById[transfer.fromId]?.name}</strong> به <strong>{peopleById[transfer.toId]?.name}</strong> بدهد</span><div className="settlement-action"><b>{money(transfer.amount)} تومان</b><button onClick={() => startSettlement(transfer)}>ثبت تسویه</button></div></div>)}</div> : <p className="settlement-empty">همهٔ حساب‌ها تسویه هستند.</p>}</section>
          </div>
          <div className="two-col"><section className="panel">
            <div className="panel-title"><div><h2>ماندهٔ نفرات</h2><p>پرداخت‌ها منهای سهم هزینه‌ها</p></div></div>
            {balances.length ? <div className="balance-list">{balances.map((person) => <div className="balance-row" key={person.id}><div className="person-info"><span className="avatar">{person.name.slice(0, 1)}</span><span>{person.name}</span></div><div className="balance-actions"><span className={`balance ${person.balance > 0 ? 'positive' : person.balance < 0 ? 'negative' : ''}`}>{person.balance > 0 ? '+' : person.balance < 0 ? '−' : ''}{money(Math.abs(person.balance))} <small>تومان</small></span>{person.balance !== 0 && <button onClick={() => startSettlement(null, person)}>ثبت تسویه</button>}</div></div>)}</div> : <Empty text="هنوز نفری ثبت نشده است." />}
          </section><section className="panel"><div className="panel-title"><div><h2>آخرین هزینه‌ها</h2><p>ثبت‌های اخیر شما</p></div><button className="text-button" onClick={() => setTab('expenses')}>همهٔ هزینه‌ها ←</button></div>{latest.length ? <div className="recent-list">{latest.map((expense) => <div className="recent-row" key={expense.id}><div><strong>{itemsById[expense.itemId]?.name ?? 'کالای حذف‌شده'}</strong><small>{peopleById[expense.payerId]?.name ?? 'نفر حذف‌شده'} · {date(expense.createdAt)}</small></div><span>{money(expense.amount)} <small>تومان</small></span></div>)}</div> : <Empty text="هنوز هزینه‌ای ثبت نشده است." />}</section></div>
          <section className="panel item-totals-panel"><div className="panel-title"><div><h2>مجموع هزینه‌ها به تفکیک کالا</h2><p>جمع مبلغ ثبت‌شده برای هر کالا</p></div></div>{itemTotals.length ? <div className="item-total-list">{itemTotals.map((item) => <div className="item-total-row" key={item.id}><div className="item-total-info"><strong>{item.name}</strong><small>{money(item.count)} عدد</small></div><div className="item-total-value"><strong>{money(item.total)} تومان</strong><div className="item-total-track"><span style={{ width: `${total ? item.total / total * 100 : 0}%` }} /></div></div></div>)}</div> : <Empty text="هنوز کالایی ثبت نشده است." />}</section>
        </>}
        {tab === 'people' && <section className="panel full-panel"><div className="panel-title"><div><h2>نفرات</h2><p>افرادی که در هزینه‌ها شریک هستند</p></div><button className="button button-dark" onClick={() => startPerson()} disabled={busy}>+ افزودن نفر</button></div>{data.people.length ? <div className="simple-list">{data.people.map((person) => <div className="simple-row" key={person.id}><div className="person-info"><span className="avatar">{person.name.slice(0, 1)}</span><strong>{person.name}</strong></div><div className="row-actions"><button onClick={() => startPerson(person)}>ویرایش</button><button className="danger" onClick={() => remove('person', person)} disabled={busy}>حذف</button></div></div>)}</div> : <Empty text="اولین نفر را اضافه کنید." />}</section>}
        {tab === 'items' && <section className="panel full-panel"><div className="panel-title"><div><h2>کالاها</h2><p>فهرست کالاها و خدمات قابل ثبت</p></div><button className="button button-dark" onClick={() => startItem()} disabled={busy}>+ افزودن کالا</button></div>{data.items.length ? <div className="simple-list">{data.items.map((item) => <div className="simple-row" key={item.id}><div className="person-info"><span className="item-icon">□</span><strong>{item.name}</strong></div><div className="row-actions"><button onClick={() => startItem(item)}>ویرایش</button><button className="danger" onClick={() => remove('item', item)} disabled={busy}>حذف</button></div></div>)}</div> : <Empty text="اولین کالا را اضافه کنید." />}</section>}
        {tab === 'expenses' && <section className="panel full-panel">
          <div className="panel-title"><div><h2>هزینه‌ها</h2><p>تمام پرداخت‌های ثبت‌شده</p></div><button className="button button-dark" onClick={() => startExpense()} disabled={busy || !data.people.length || !data.items.length}>+ ثبت هزینه</button></div>
          {(!data.people.length || !data.items.length) && <div className="inline-hint">برای ثبت هزینه، ابتدا دست‌کم یک نفر و یک کالا اضافه کنید.</div>}
          {expenseGroups.length ? <div className="expense-list">{expenseGroups.map((group) => <div className="expense-group" key={group.day}>
            <div className="expense-group-header"><h3>{date(group.expenses[0].createdAt)}</h3><span>مجموع روز: <strong>{money(group.total)} تومان</strong></span></div>
            {group.expenses.map((expense) => <div className="expense-row" key={expense.id}><div className="expense-main"><span className="item-icon">□</span><div><strong>{itemsById[expense.itemId]?.name ?? 'کالای حذف‌شده'} · {money(expense.quantity ?? 1)} عدد</strong><small>پرداخت: {peopleById[expense.payerId]?.name ?? 'نفر حذف‌شده'} · {money(expense.participantIds.length)} شریک</small></div></div><div className="expense-end"><strong>{money(expense.amount)} <small>تومان</small></strong><div className="row-actions"><button onClick={() => startExpense(expense)}>ویرایش</button><button className="danger" onClick={() => remove('expense', expense)} disabled={busy}>حذف</button></div></div></div>)}
          </div>)}</div> : <Empty text="هنوز هزینه‌ای ثبت نشده است." />}
        </section>}
        {tab === 'settlements' && <section className="panel full-panel">
          <div className="panel-title"><div><h2>تسویه‌های ثبت‌شده</h2><p>پرداخت‌های انجام‌شده بین نفرات</p></div></div>
          {data.settlements.length ? <div className="simple-list">{[...data.settlements].reverse().map((settlement) => <div className="simple-row" key={settlement.id}><div className="settlement-history"><strong>{peopleById[settlement.fromId]?.name} به {peopleById[settlement.toId]?.name} پرداخت کرد</strong><small>{date(settlement.createdAt)}</small></div><div className="settlement-history-end"><b>{money(settlement.amount)} تومان</b><div className="row-actions"><button className="danger" onClick={() => remove('settlement', settlement)} disabled={busy}>حذف</button></div></div></div>)}</div> : <Empty text="هنوز تسویه‌ای ثبت نشده است." />}
        </section>}
      </>}
    </main>

    {tickerText && <div className="ticker" aria-label="پیام برنامه"><span key={tickerRun} dir="rtl">{tickerText}</span></div>}

    {cloneOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setCloneOpen(false); }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="clone-title"><div className="modal-header"><h2 id="clone-title">کپی از فایل فعلی</h2><button className="close" onClick={() => setCloneOpen(false)} disabled={busy} aria-label="بستن">×</button></div><p className="clone-hint">نفرات و کالاها کپی می‌شوند. هزینه‌ها و تسویه‌ها در فایل جدید خالی خواهند بود.</p>{error && <div className="alert" role="alert">{error}</div>}<form onSubmit={createCopy}><label>عنوان فایل جدید<input autoFocus required maxLength="80" value={cloneTitle} onChange={(event) => setCloneTitle(event.target.value)} placeholder="مثلاً هزینه‌های ماه آینده" /></label><div className="modal-actions"><button type="button" className="button button-light" onClick={() => setCloneOpen(false)} disabled={busy}>انصراف</button><button className="button button-dark" disabled={busy}>انتخاب محل و ساخت کپی</button></div></form></div></div>}

    {editing && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-header"><h2 id="modal-title">{editing.id ? 'ویرایش' : 'افزودن'} {editing.type === 'person' ? 'نفر' : editing.type === 'item' ? 'کالا' : editing.type === 'settlement' ? 'تسویه' : 'هزینه'}</h2><button className="close" onClick={() => setEditing(null)} aria-label="بستن">×</button></div>{error && <div className="alert" role="alert">{error}</div>}{editing.type === 'settlement' ? <form onSubmit={saveSettlement}><label>پرداخت‌کننده<select required value={form.fromId} onChange={(event) => setForm({ ...form, fromId: event.target.value })}>{balances.filter((person) => person.balance < 0).map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label><label>دریافت‌کننده<select required value={form.toId} onChange={(event) => setForm({ ...form, toId: event.target.value })}>{balances.filter((person) => person.balance > 0).map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label><label>مبلغ پرداخت‌شده (تومان)<input required type="number" min="1" step="1" inputMode="numeric" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label><label>تاریخ شمسی<input required type="text" dir="ltr" inputMode="numeric" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} placeholder="۱۴۰۵/۰۷/۱۳" /></label><div className="modal-actions"><button type="button" className="button button-light" onClick={() => setEditing(null)}>انصراف</button><button className="button button-dark" disabled={busy}>ثبت تسویه</button></div></form> : editing.type === 'expense' ? <form onSubmit={saveExpense}><label>کالا<select required value={form.itemId} onChange={(event) => setForm({ ...form, itemId: event.target.value })}>{data.items.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>پرداخت‌کننده<select required value={form.payerId} onChange={(event) => setForm({ ...form, payerId: event.target.value })}>{data.people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label><label>تعداد<input required type="number" min="1" step="1" inputMode="numeric" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></label><label>مبلغ کل (تومان)<input required type="number" min="1" step="1" inputMode="numeric" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="مثلاً ۵۰۰۰۰۰" /></label><label>تاریخ شمسی<input required type="text" dir="ltr" inputMode="numeric" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} placeholder="۱۴۰۵/۰۷/۱۳" /></label><fieldset><legend>افراد شریک در این هزینه</legend><div className="participants">{data.people.map((person) => <label className="checkbox-label" key={person.id}><input type="checkbox" checked={form.participantIds.includes(person.id)} onChange={(event) => setForm({ ...form, participantIds: event.target.checked ? [...form.participantIds, person.id] : form.participantIds.filter((personId) => personId !== person.id) })} />{person.name}</label>)}</div></fieldset><div className="modal-actions"><button type="button" className="button button-light" onClick={() => setEditing(null)}>انصراف</button><button className="button button-dark" disabled={busy}>ذخیرهٔ هزینه</button></div></form> : <form onSubmit={(event) => saveNamed(editing.type, event)}><label>نام {editing.type === 'person' ? 'نفر' : 'کالا'}<input autoFocus required maxLength="80" value={form.name} onChange={(event) => setForm({ name: event.target.value })} placeholder={editing.type === 'person' ? 'مثلاً علی رضایی' : 'مثلاً لوازم تحریر'} /></label><div className="modal-actions"><button type="button" className="button button-light" onClick={() => setEditing(null)}>انصراف</button><button className="button button-dark" disabled={busy}>ذخیره</button></div></form>}</div></div>}
  </div>;
}

function Empty({ text }) { return <div className="empty"><span>○</span><p>{text}</p></div>; }

createRoot(document.getElementById('root')).render(<App />);

