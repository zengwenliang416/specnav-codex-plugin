'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createPlaywrightApiGuard
} = require(
  '../../../plugins/specnav-verification/kernel/execution/playwright-api-guard'
);

class Locator {
  textContent() {
    return 'ready';
  }

  click() {
    throw new Error('raw locator click must not run');
  }

  screenshot() {
    throw new Error('raw locator screenshot must not run');
  }
}

class Keyboard {
  press() {
    throw new Error('raw keyboard press must not run');
  }
}

class Mouse {
  click() {
    throw new Error('raw mouse click must not run');
  }
}

class Touchscreen {
  tap() {
    throw new Error('raw touchscreen tap must not run');
  }
}

class Page {
  constructor() {
    this.keyboard = new Keyboard();
    this.mouse = new Mouse();
    this.touchscreen = new Touchscreen();
  }

  locator() {
    return new Locator();
  }

  url() {
    return 'https://example.test/ready';
  }

  goto() {
    throw new Error('raw page goto must not run');
  }

  screenshot() {
    throw new Error('raw page screenshot must not run');
  }
}

class BrowserContext {}
class Browser {}

test('Midscene oracle guard permits reads and blocks page mutation', async () => {
  const denied = [];
  const guard = createPlaywrightApiGuard({
    browser: new Browser(),
    context: new BrowserContext(),
    page: new Page(),
    readOnly: true,
    onDenied(detail) {
      denied.push(detail);
    }
  });

  assert.equal(guard.page.url(), 'https://example.test/ready');
  assert.equal(await guard.page.locator('main').textContent(), 'ready');
  assert.throws(
    () => guard.page.goto('https://example.test/other'),
    /Playwright access denied: page\.goto/
  );
  assert.throws(
    () => guard.page.locator('button').click(),
    /Playwright access denied: playwright\.click/
  );
  assert.throws(
    () => guard.page.screenshot({ path: 'screenshot.png' }),
    /Playwright access denied: page\.screenshot/
  );
  assert.throws(
    () => guard.page.locator('main').screenshot({
      path: 'screenshot.png'
    }),
    /Playwright access denied: playwright\.screenshot/
  );
  assert.throws(
    () => guard.page.keyboard.press('Enter'),
    /Playwright access denied: playwright\.press/
  );
  assert.throws(
    () => guard.page.mouse.click(1, 1),
    /Playwright access denied: playwright\.click/
  );
  assert.throws(
    () => guard.page.touchscreen.tap(1, 1),
    /Playwright access denied: playwright\.tap/
  );
  assert.throws(
    () => {
      guard.page.url = () => 'tampered';
    },
    /Playwright access denied: page\.set\.url/
  );
  assert.throws(
    () => Object.defineProperty(guard.page, 'url', {
      value: () => 'tampered'
    }),
    /Playwright access denied: page\.defineProperty\.url/
  );
  assert.throws(
    () => {
      delete guard.page.url;
    },
    /Playwright access denied: page\.delete\.url/
  );
  assert.throws(
    () => Object.getOwnPropertyDescriptor(guard.page, 'keyboard'),
    /Playwright access denied: page\.descriptor\.keyboard/
  );
  assert.throws(
    () => Reflect.ownKeys(guard.page),
    /Playwright access denied: page\.ownKeys/
  );
  assert.throws(
    () => Object.preventExtensions(guard.page),
    /Playwright access denied: page\.preventExtensions/
  );
  assert.throws(
    () => Object.setPrototypeOf(guard.page, null),
    /Playwright access denied: page\.setPrototypeOf/
  );
  assert.equal(guard.page.url(), 'https://example.test/ready');
  assert.deepEqual(denied, [
    'page.goto',
    'playwright.click',
    'page.screenshot',
    'playwright.screenshot',
    'playwright.press',
    'playwright.click',
    'playwright.tap',
    'page.set.url',
    'page.defineProperty.url',
    'page.delete.url',
    'page.descriptor.keyboard',
    'page.ownKeys',
    'page.preventExtensions',
    'page.setPrototypeOf'
  ]);
});
