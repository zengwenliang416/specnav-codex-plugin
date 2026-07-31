'use strict';

const DENIED_METHODS = Object.freeze({
  browser: new Set([
    'newBrowserCDPSession',
    'newContext',
    'newPage'
  ]),
  context: new Set([
    'newCDPSession',
    'route',
    'routeWebSocket',
    'unroute',
    'unrouteAll',
    'unrouteWebSocket'
  ]),
  page: new Set([
    'route',
    'routeWebSocket',
    'unroute',
    'unrouteAll',
    'unrouteWebSocket'
  ])
});

const READ_ONLY_ALLOWED_METHODS = Object.freeze({
  browser: new Set(),
  context: new Set([
    'browser',
    'cookies',
    'isClosed',
    'pages'
  ]),
  page: new Set([
    '$',
    '$$',
    'content',
    'context',
    'frame',
    'frameLocator',
    'frames',
    'getByAltText',
    'getByLabel',
    'getByPlaceholder',
    'getByRole',
    'getByTestId',
    'getByText',
    'getByTitle',
    'isClosed',
    'locator',
    'mainFrame',
    'opener',
    'title',
    'url',
    'viewportSize',
    'waitForLoadState',
    'waitForSelector',
    'waitForTimeout',
    'waitForURL'
  ]),
  playwright: new Set([
    '$',
    '$$',
    'all',
    'allInnerTexts',
    'allTextContents',
    'and',
    'ariaSnapshot',
    'asElement',
    'boundingBox',
    'content',
    'count',
    'elementHandle',
    'elementHandles',
    'filter',
    'first',
    'frameLocator',
    'getAttribute',
    'getByAltText',
    'getByLabel',
    'getByPlaceholder',
    'getByRole',
    'getByTestId',
    'getByText',
    'getByTitle',
    'headers',
    'headersArray',
    'innerHTML',
    'innerText',
    'inputValue',
    'isChecked',
    'isDisabled',
    'isEditable',
    'isEnabled',
    'isHidden',
    'isVisible',
    'json',
    'jsonValue',
    'last',
    'locator',
    'method',
    'name',
    'nth',
    'ok',
    'or',
    'ownerFrame',
    'request',
    'response',
    'status',
    'statusText',
    'text',
    'textContent',
    'type',
    'url',
    'value',
    'waitFor',
    'waitForElementState'
  ])
});

const PLAYWRIGHT_TYPES = new Set([
  'APIRequestContext',
  'Browser',
  'BrowserContext',
  'BrowserType',
  'CDPSession',
  'Clock',
  'ConsoleMessage',
  'Coverage',
  'Dialog',
  'Download',
  'ElementHandle',
  'FileChooser',
  'Frame',
  'FrameLocator',
  'JSHandle',
  'Keyboard',
  'Locator',
  'Mouse',
  'Page',
  'Request',
  'Response',
  'Route',
  'Touchscreen',
  'Tracing',
  'Video',
  'WebSocket',
  'WebSocketRoute',
  'Worker'
]);

const EVENT_METHODS = new Set([
  'addListener',
  'on',
  'once',
  'prependListener'
]);

function objectKind(value, roots) {
  if (value === roots.browser) return 'browser';
  if (value === roots.context) return 'context';
  if (value === roots.page) return 'page';
  const name = value?.constructor?.name;
  if (name === 'Browser') return 'browser';
  if (name === 'BrowserContext') return 'context';
  if (name === 'Page') return 'page';
  return PLAYWRIGHT_TYPES.has(name) ? 'playwright' : null;
}

function createPlaywrightApiGuard(options) {
  const roots = {
    browser: options.browser,
    context: options.context,
    page: options.page
  };
  if (typeof options.onDenied !== 'function') {
    throw new Error('playwright api guard requires onDenied');
  }
  const proxyCache = new WeakMap();
  const callbackCache = new WeakMap();

  function denied(kind, property) {
    const detail = `${kind}.${String(property)}`;
    options.onDenied(detail);
    throw new Error(`Playwright access denied: ${detail}`);
  }

  function guardFunction(callback, kind, property) {
    return new Proxy(callback, {
      get(target, member, receiver) {
        if (member === 'constructor' || member === 'prototype') {
          return denied(kind, `${String(property)}.${String(member)}`);
        }
        return Reflect.get(target, member, receiver);
      },
      getPrototypeOf() {
        return denied(kind, `${String(property)}.prototype`);
      }
    });
  }

  function wrapCallback(callback, argumentKind = null, thisKind = null) {
    if (typeof callback !== 'function') return callback;
    const callbackKind = `${argumentKind || 'auto'}:${thisKind || 'auto'}`;
    let byKind = callbackCache.get(callback);
    if (!byKind) {
      byKind = new Map();
      callbackCache.set(callback, byKind);
    }
    if (byKind.has(callbackKind)) return byKind.get(callbackKind);
    const wrapped = function guardedPlaywrightCallback(...args) {
      return callback.apply(
        wrap(this, thisKind),
        args.map((entry, index) => (
          index === 0
            ? wrapCallbackValue(entry, argumentKind)
            : wrapCallbackValue(entry)
        ))
      );
    };
    const guarded = guardFunction(
      wrapped,
      thisKind || argumentKind || 'playwright',
      'callback'
    );
    byKind.set(callbackKind, guarded);
    return guarded;
  }

  function wrapCallbackValue(value, forcedKind = null) {
    const guarded = wrap(value, forcedKind);
    if (guarded !== value) return guarded;
    if (Array.isArray(value)) {
      return value.map((entry) => wrapCallbackValue(entry));
    }
    if (
      value
      && typeof value === 'object'
      && (
        Object.getPrototypeOf(value) === Object.prototype
        || Object.getPrototypeOf(value) === null
      )
    ) {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => (
        [key, wrapCallbackValue(entry)]
      )));
    }
    return value;
  }

  function wrapEventOptions(value) {
    if (
      !value
      || typeof value !== 'object'
      || Array.isArray(value)
      || typeof value.predicate !== 'function'
    ) {
      return value;
    }
    return {
      ...value,
      predicate: wrapCallback(value.predicate)
    };
  }

  function wrapResult(value, forcedKind = null) {
    if (value && typeof value.then === 'function') {
      return value.then((entry) => wrap(entry, forcedKind));
    }
    return wrap(value, forcedKind);
  }

  function wrap(value, forcedKind = null) {
    if (Array.isArray(value)) return value.map(wrap);
    if (!value || typeof value !== 'object') return value;
    const kind = forcedKind || objectKind(value, roots);
    if (!kind) return value;
    if (proxyCache.has(value)) return proxyCache.get(value);

    const proxy = new Proxy(value, {
      defineProperty(target, property, descriptor) {
        if (options.readOnly === true) {
          return denied(kind, `defineProperty.${String(property)}`);
        }
        return Reflect.defineProperty(target, property, descriptor);
      },
      deleteProperty(target, property) {
        if (options.readOnly === true) {
          return denied(kind, `delete.${String(property)}`);
        }
        if (typeof property === 'string' && property.startsWith('_')) {
          return denied(kind, 'private');
        }
        return Reflect.deleteProperty(target, property);
      },
      get(target, property) {
        if (typeof property === 'string' && property.startsWith('_')) {
          return denied(kind, 'private');
        }
        if (property === 'constructor') {
          return denied(kind, 'constructor');
        }
        const methodSet = DENIED_METHODS[kind];
        if (methodSet?.has(property)) {
          return () => denied(kind, property);
        }
        const member = Reflect.get(target, property, target);
        if (typeof member !== 'function') return wrap(member);
        if (
          options.readOnly === true
          && !READ_ONLY_ALLOWED_METHODS[kind]?.has(property)
        ) {
          return () => denied(kind, property);
        }
        return guardFunction((...args) => {
          let guardedArgs = args;
          const eventKind = ['page', 'popup'].includes(args[0])
            ? 'page'
            : null;
          if (EVENT_METHODS.has(property) && args.length >= 2) {
            guardedArgs = [
              args[0],
              wrapCallback(args[1], eventKind, kind),
              ...args.slice(2)
            ];
          } else if (property === 'off' || property === 'removeListener') {
            const callbackKind = `${
              ['page', 'popup'].includes(args[0]) ? 'page' : 'auto'
            }:${kind}`;
            const cached = callbackCache.get(args[1]);
            guardedArgs = [
              args[0],
              cached?.get(callbackKind) || args[1],
              ...args.slice(2)
            ];
          } else if (property === 'waitForEvent' && args.length >= 2) {
            guardedArgs = [
              args[0],
              typeof args[1] === 'function'
                ? wrapCallback(args[1], eventKind, kind)
                : wrapEventOptions(args[1])
            ];
          } else if (property === 'exposeBinding' && args.length >= 2) {
            guardedArgs = [
              args[0],
              wrapCallback(args[1], null, kind),
              ...args.slice(2)
            ];
          }
          return wrapResult(
            Reflect.apply(member, target, guardedArgs),
            property === 'waitForEvent' ? eventKind : null
          );
        }, kind, property);
      },
      getPrototypeOf() {
        return denied(kind, 'prototype');
      },
      getOwnPropertyDescriptor(target, property) {
        if (options.readOnly === true) {
          return denied(kind, `descriptor.${String(property)}`);
        }
        if (typeof property === 'string' && property.startsWith('_')) {
          return undefined;
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      ownKeys(target) {
        if (options.readOnly === true) {
          return denied(kind, 'ownKeys');
        }
        return Reflect.ownKeys(target).filter((property) => (
          typeof property !== 'string' || !property.startsWith('_')
        ));
      },
      preventExtensions(target) {
        if (options.readOnly === true) {
          return denied(kind, 'preventExtensions');
        }
        return Reflect.preventExtensions(target);
      },
      set(target, property, value) {
        if (options.readOnly === true) {
          return denied(kind, `set.${String(property)}`);
        }
        if (typeof property === 'string' && property.startsWith('_')) {
          return denied(kind, 'private');
        }
        return Reflect.set(target, property, value, target);
      },
      setPrototypeOf(target, prototype) {
        if (options.readOnly === true) {
          return denied(kind, 'setPrototypeOf');
        }
        return Reflect.setPrototypeOf(target, prototype);
      }
    });
    proxyCache.set(value, proxy);
    return proxy;
  }

  return Object.freeze({
    browser: wrap(roots.browser),
    context: wrap(roots.context),
    page: wrap(roots.page)
  });
}

module.exports = {
  createPlaywrightApiGuard
};
