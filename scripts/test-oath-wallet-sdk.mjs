import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';

import * as sdk from '@reown/appkit-controllers';
import ts from 'typescript';
import * as connectors from 'wagmi/connectors';

// Compile the production helper; substitute only Vite's SVG loader.
const source = readFileSync(new URL('../src/helpers/oathWallet.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const exports = {};
new Function('require', 'exports', compiled)((specifier) => {
  if (specifier === '../assets/oath-wallet.svg') return { default: 'oath-wallet.svg' };
  if (specifier === 'wagmi/connectors') return connectors;
  throw new Error(`Unexpected module: ${specifier}`);
}, exports);
const { presentOathWallet, OATH_WALLET } = exports;

for (const mobile of [false, true]) {
  test(`installed SDK preserves Oath on reopen and restores generic routing (mobile=${mobile})`, async () => {
    const original = {
      prefetch: sdk.ApiController.prefetch,
      isMobile: sdk.CoreHelperUtil.isMobile,
      sendEvent: sdk.EventsController.sendEvent,
      manualControl: sdk.OptionsController.state.manualWCControl,
    };
    // Keep this a host-only controller test: no API, analytics or wallet connection.
    sdk.ApiController.prefetch = async () => [];
    sdk.CoreHelperUtil.isMobile = () => mobile;
    sdk.EventsController.sendEvent = () => undefined;
    sdk.OptionsController.setManualWCControl(true);
    const dispose = presentOathWallet(sdk);
    try {
      await sdk.ModalController.open();
      await setImmediate();
      assert.equal(sdk.RouterController.state.view, 'ConnectingWalletConnect');
      assert.equal(sdk.RouterController.state.data?.wallet?.id, OATH_WALLET.id);

      await sdk.ModalController.open();
      await setImmediate();
      assert.equal(sdk.RouterController.state.view, 'ConnectingWalletConnect');
      assert.equal(sdk.RouterController.state.data?.wallet?.id, OATH_WALLET.id);

      sdk.ModalController.close();
      dispose();
      await sdk.ModalController.open();
      await setImmediate();
      assert.equal(sdk.RouterController.state.view, mobile ? 'AllWallets' : 'ConnectingWalletConnectBasic');
      assert.equal(sdk.RouterController.state.data, undefined);
    } finally {
      sdk.ModalController.close();
      dispose();
      sdk.OptionsController.setManualWCControl(original.manualControl);
      sdk.ApiController.prefetch = original.prefetch;
      sdk.CoreHelperUtil.isMobile = original.isMobile;
      sdk.EventsController.sendEvent = original.sendEvent;
    }
  });
}
