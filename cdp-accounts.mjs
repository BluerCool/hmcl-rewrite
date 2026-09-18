import { writeFileSync } from 'node:fs';

const CDP_URL = 'http://127.0.0.1:9222';

async function getTarget() {
  const res = await fetch(`${CDP_URL}/json`);
  const targets = await res.json();
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('No page target');
  return page.webSocketDebuggerUrl;
}

let id = 1;
function cdpSend(ws, method, params = {}) {
  const msgId = id++;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('CDP timeout')), 15000);
    const handler = (event) => {
      const data = JSON.parse(event.data);
      if (data.id === msgId) {
        clearTimeout(timeout);
        ws.removeEventListener('message', handler);
        if (data.error) reject(new Error(data.error.message));
        else resolve(data.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}

async function evaluate(ws, expression) {
  const result = await cdpSend(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

const results = [];
function check(name, passed) {
  results.push({ name, passed });
  console.log(`${passed ? '✅' : '❌'} ${name}`);
}

try {
  const wsUrl = await getTarget();
  const wsc = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    wsc.onopen = resolve;
    wsc.onerror = reject;
  });
  await cdpSend(wsc, 'Runtime.enable');

  await new Promise(r => setTimeout(r, 2000));

  // 1. Navigate to accounts page via sidebar
  await evaluate(wsc, `document.querySelector('.account-item')?.click()`);
  await new Promise(r => setTimeout(r, 500));

  // 2. Page title is 账户列表
  const title = await evaluate(wsc, `document.querySelector('.page-title')?.textContent`);
  check('Page title is "账户列表"', title === '账户列表');

  // 3. Left drawer: class-title 添加账户
  const classTitle = await evaluate(wsc, `
    (() => {
      const els = document.querySelectorAll('.accounts-page .class-title');
      return els.length > 0 ? els[0].textContent : null;
    })()
  `);
  check('Left drawer title "添加账户"', classTitle === '添加账户');

  // 4. Drawer items 微软账户 / 离线模式
  const drawer = await evaluate(wsc, `
    (() => {
      const items = document.querySelectorAll('.accounts-page .advanced-list-item');
      return Array.from(items).map(i => i.textContent);
    })()
  `);
  check('Drawer has 微软账户+离线模式', drawer.length === 2 && drawer[0] === '微软账户' && drawer[1] === '离线模式');

  // 5. Account cards may be empty initially (fresh store) — clean out leftovers first
  await evaluate(wsc, `
    (() => {
      const cards = document.querySelectorAll('.account-card-global');
      for (const c of cards) {
        const t = c.querySelector('.two-line .title')?.textContent;
        if (t === 'TestPlayer' || t === 'CDP_Actor') {
          const buttons = c.querySelectorAll('.account-icon-actions .icon-button');
          buttons[buttons.length - 1].click();
        }
      }
    })()
  `);
  await new Promise(r => setTimeout(r, 600));

  // 7. Open offline sheet
  await evaluate(wsc, `
    (() => {
      const buttons = document.querySelectorAll('.accounts-page .advanced-list-item');
      for (const b of buttons) if (b.textContent === '离线模式') b.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 400));
  const sheetTitle = await evaluate(wsc, `document.querySelector('.sheet .dialog-heading')?.textContent`);
  check('Offline sheet title "添加离线模式账户"', sheetTitle === '添加离线模式账户');
  const usernameInput = await evaluate(wsc, `!!document.querySelector('.sheet input')`);
  check('Offline sheet has username input', usernameInput === true);

  // X. Add initial account "TestPlayer"
  await evaluate(wsc, `
    (() => {
      const input = document.querySelector('.sheet input');
      if (input) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, 'TestPlayer');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()
  `);
  await new Promise(r => setTimeout(r, 100));
  await evaluate(wsc, `
    (() => {
      const buttons = document.querySelectorAll('.sheet .sheet-actions button');
      for (const b of buttons) if (b.textContent === '登录') b.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 1000));

  // 5b. Account cards now present
  const cards = await evaluate(wsc, `document.querySelectorAll('.account-card-global').length`);
  check(`Account cards present (${cards})`, cards >= 1);

  // 6. Card has radio + avatar + title + subtitle
  const cardDetails = await evaluate(wsc, `
    (() => {
      const card = document.querySelector('.account-card-global');
      if (!card) return null;
      return {
        radio: !!card.querySelector('input.account-radio'),
        avatar: !!card.querySelector('.account-avatar'),
        title: card.querySelector('.two-line .title')?.textContent,
        subtitle: card.querySelector('.two-line .subtitle')?.textContent,
        actions: card.querySelectorAll('.account-icon-actions .icon-button').length
      };
    })()
  `);
  check('Card has radio+avatar+title+subtitle', cardDetails.radio && cardDetails.avatar && !!cardDetails.title && !!cardDetails.subtitle);
  console.log(`       card: ${JSON.stringify(cardDetails)}`);
  check('Card has copy+delete actions', cardDetails.actions === 2);

  // 8. Open offline sheet again, submit a second account "CDP_Actor"
  await evaluate(wsc, `
    (() => {
      const buttons = document.querySelectorAll('.accounts-page .advanced-list-item');
      for (const b of buttons) if (b.textContent === '离线模式') b.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 300));
  await evaluate(wsc, `
    (() => {
      const input = document.querySelector('.sheet input');
      if (input) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, 'CDP_Actor');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()
  `);
  await new Promise(r => setTimeout(r, 100));
  await evaluate(wsc, `
    (() => {
      const buttons = document.querySelectorAll('.sheet .sheet-actions button');
      for (const b of buttons) if (b.textContent === '登录') b.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 1000));

  // 9. New account appears
  const added = await evaluate(wsc, `
    (() => {
      const cards = document.querySelectorAll('.account-card-global');
      for (const c of cards) {
        if (c.querySelector('.two-line .title')?.textContent === 'CDP_Actor') return true;
      }
      return false;
    })()
  `);
  check('New account "CDP_Actor" added', added === true);

  // 10. New account is selected automatically
  const selected = await evaluate(wsc, `
    (() => {
      const cards = document.querySelectorAll('.account-card-global');
      for (const c of cards) {
        const t = c.querySelector('.two-line .title')?.textContent;
        const r = c.querySelector('input.account-radio');
        if (t === 'CDP_Actor') return r.checked;
      }
      return false;
    })()
  `);
  check('New account radio is selected', selected === true);

  // 11. Select the previous account via radio click
  await evaluate(wsc, `
    (() => {
      const cards = document.querySelectorAll('.account-card-global');
      for (const c of cards) {
        const t = c.querySelector('.two-line .title')?.textContent;
        if (t === 'TestPlayer') c.click();
      }
    })()
  `);
  await new Promise(r => setTimeout(r, 400));
  const sidebarName = await evaluate(wsc, `document.querySelector('.account-item .nav-text')?.textContent`);
  check('Sidebar now shows TestPlayer', sidebarName === 'TestPlayer');

  // 12. Delete the CDP_Actor account
  await evaluate(wsc, `
    (() => {
      const cards = document.querySelectorAll('.account-card-global');
      for (const c of cards) {
        const t = c.querySelector('.two-line .title')?.textContent;
        if (t === 'CDP_Actor') {
          const buttons = c.querySelectorAll('.account-icon-actions .icon-button');
          buttons[buttons.length - 1].click();
        }
      }
    })()
  `);
  await new Promise(r => setTimeout(r, 800));
  const gone = await evaluate(wsc, `
    (() => {
      const cards = document.querySelectorAll('.account-card-global');
      for (const c of cards) {
        if (c.querySelector('.two-line .title')?.textContent === 'CDP_Actor') return false;
      }
      return true;
    })()
  `);
  check('Account CDP_Actor deleted', gone === true);

  // 13. Screenshots
  const shot = await cdpSend(wsc, 'Page.captureScreenshot', { format: 'png' });
  writeFileSync('/tmp/opencode/accounts-redesign.png', Buffer.from(shot.data, 'base64'));
  console.log('\nScreenshot: /tmp/opencode/accounts-redesign.png');

  // 14. Open microsoft sheet for screenshot
  await evaluate(wsc, `
    (() => {
      const buttons = document.querySelectorAll('.accounts-page .advanced-list-item');
      for (const b of buttons) if (b.textContent === '微软账户') b.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 300));
  const msTitle = await evaluate(wsc, `document.querySelector('.sheet .dialog-heading')?.textContent`);
  check('Microsoft sheet title "添加微软账户"', msTitle === '添加微软账户');
  const shot2 = await cdpSend(wsc, 'Page.captureScreenshot', { format: 'png' });
  writeFileSync('/tmp/opencode/accounts-ms-sheet.png', Buffer.from(shot2.data, 'base64'));
  console.log('Screenshot: /tmp/opencode/accounts-ms-sheet.png');
  // Close sheet
  await evaluate(wsc, `
    (() => {
      const buttons = document.querySelectorAll('.sheet .sheet-actions button');
      for (const b of buttons) if (b.textContent === '取消') b.click();
    })()
  `);

  wsc.close();
  console.log(`\n=== ${results.filter(r => r.passed).length}/${results.length} PASS ===`);
  if (results.some(r => !r.passed)) process.exit(1);
} catch (e) {
  console.error('FATAL:', e);
  process.exit(1);
}