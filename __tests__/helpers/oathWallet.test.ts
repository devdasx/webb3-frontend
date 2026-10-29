import { walletConnect } from 'wagmi/connectors';

import { oathWallet, OATH_CHAIN_IDS, OATH_WALLET, presentOathWallet } from '../../src/helpers/oathWallet';

jest.mock('wagmi/connectors', () => ({ walletConnect: jest.fn() }));
jest.mock('../../src/assets/oath-wallet.svg', () => 'oath-wallet.svg');
jest.mock('@reown/appkit-controllers', () => ({
  ModalController: { state: { open: false }, subscribeKey: jest.fn(() => jest.fn()) },
  ConnectionController: { resetUri: jest.fn() },
  SnackController: { hide: jest.fn() },
  RouterController: { reset: jest.fn(), subscribeKey: jest.fn(() => jest.fn()) },
}));

const topic = 'a'.repeat(64);
const otherTopic = 'b'.repeat(64);
const uri = `wc:${topic}@2?relay-protocol=irn&symKey=${'c'.repeat(64)}`;

function setup() {
  const provider = {
    session: undefined as { pairingTopic: string } | undefined,
    signer: {
      client: {
        proposal: {
          getAll: jest.fn(() => [
            { id: 1, pairingTopic: topic },
            { id: 2, pairingTopic: otherTopic },
          ]),
        },
        core: { expirer: { set: jest.fn() }, pairing: { disconnect: jest.fn().mockResolvedValue(undefined) } },
      },
    },
  };
  const result = { accounts: ['0x0000000000000000000000000000000000000001'], chainId: 1 };
  const base = {
    id: 'walletConnect',
    name: 'WalletConnect',
    getProvider: jest.fn().mockResolvedValue(provider),
    connect: jest.fn().mockResolvedValue(result),
    disconnect: jest.fn().mockResolvedValue(undefined),
    onDisplayUri: jest.fn(),
    onConnect: jest.fn(),
  };
  const factory = jest.fn((config: { chains: { id: number }[] }) => {
    expect(config.chains.length).toBeGreaterThan(0);
    return base;
  });
  jest.mocked(walletConnect).mockReturnValue(factory as unknown as ReturnType<typeof walletConnect>);
  const config = { chains: [{ id: 1 }, { id: 8453 }, { id: 5000 }, { id: 2020 }, { id: 11155111 }] };
  const connector = oathWallet({ projectId: 'test-project' })(
    config as unknown as Parameters<ReturnType<typeof walletConnect>>[0],
  );
  return { connector, provider, base, factory, result };
}

beforeEach(() => jest.clearAllMocks());

test('uses an isolated named connector and only supported Compound mainnets', () => {
  const { connector, factory, base } = setup();
  expect(connector.id).toBe('oath-wallet');
  expect(connector.name).toBe('Oath Wallet');
  expect(base.id).toBe('walletConnect');
  expect(factory.mock.calls[0][0].chains.map((chain: { id: number }) => chain.id)).toEqual([1, 8453]);
  expect(walletConnect).toHaveBeenCalledWith(
    expect.objectContaining({ customStoragePrefix: 'compound-oath', logger: 'silent', telemetryEnabled: false }),
  );
  expect(OATH_CHAIN_IDS).not.toContain(5000);
  expect(OATH_CHAIN_IDS).not.toContain(2020);
  expect(OATH_CHAIN_IDS).not.toContain(11155111);
});

test('routes directly to the Oath connection screen, then removes both subscriptions', () => {
  let opened: (open: boolean) => void = () => undefined;
  let viewChanged: (view: string) => void = () => undefined;
  const first = jest.fn(),
    second = jest.fn(),
    reset = jest.fn(),
    resetUri = jest.fn();
  const controllers = {
    ModalController: {
      state: { open: true },
      subscribeKey: (_key: string, cb: typeof opened) => {
        opened = cb;
        return first;
      },
    },
    RouterController: {
      reset,
      subscribeKey: (_key: string, cb: typeof viewChanged) => {
        viewChanged = cb;
        return second;
      },
    },
    ConnectionController: { resetUri },
    SnackController: { hide: jest.fn() },
  };
  const dispose = presentOathWallet(controllers as unknown as Parameters<typeof presentOathWallet>[0]);
  opened(true);
  viewChanged('ConnectingWalletConnectBasic');
  expect(reset).toHaveBeenCalledTimes(2);
  expect(reset).toHaveBeenLastCalledWith('ConnectingWalletConnect', { wallet: OATH_WALLET });
  dispose();
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
  expect(reset).toHaveBeenLastCalledWith('Connect');
  expect(resetUri).toHaveBeenCalledTimes(2);
});

test('returns the SDK connection result without changing account or chain data', async () => {
  const { connector, base, result } = setup();
  expect(await connector.connect({ chainId: 8453 })).toEqual(result);
  expect(base.connect).toHaveBeenCalledWith({ chainId: 8453 });
  expect(base.disconnect).not.toHaveBeenCalled();
});

test('does not open a modal while restoring an approved session', async () => {
  const { connector, provider } = setup();
  provider.session = { pairingTopic: topic };
  await connector.connect({ isReconnecting: true });
  const { ModalController } = await import('@reown/appkit-controllers');
  expect(ModalController.subscribeKey).not.toHaveBeenCalled();
});

test('cancels only the current proposal and pairing, preserving unrelated pairings', async () => {
  const { connector, provider, base } = setup();
  base.connect.mockImplementation(async () => {
    connector.onDisplayUri(uri);
    throw new Error('Connection request reset');
  });
  await expect(connector.connect()).rejects.toThrow('Connection request reset');
  expect(provider.signer.client.core.expirer.set).toHaveBeenCalledTimes(1);
  expect(provider.signer.client.core.expirer.set).toHaveBeenCalledWith(1, 0);
  expect(provider.signer.client.core.pairing.disconnect).toHaveBeenCalledWith({ topic });
  expect(base.disconnect).not.toHaveBeenCalled();
});

test('disconnects a late approval from a cancelled pairing without registering it', async () => {
  const { connector, provider, base } = setup();
  base.connect.mockImplementation(async () => {
    connector.onDisplayUri(uri);
    throw new Error('cancelled');
  });
  await expect(connector.connect()).rejects.toThrow('cancelled');
  provider.session = { pairingTopic: topic };
  await connector.onConnect({ chainId: '0x1' });
  expect(base.disconnect).toHaveBeenCalledTimes(1);
  expect(base.onConnect).not.toHaveBeenCalled();
});

test('keeps a different approved session when a cancelled attempt emits connect', async () => {
  const { connector, provider, base } = setup();
  base.connect.mockImplementation(async () => {
    connector.onDisplayUri(uri);
    throw new Error('cancelled');
  });
  await expect(connector.connect()).rejects.toThrow('cancelled');
  provider.session = { pairingTopic: otherTopic };
  await connector.onConnect({ chainId: '0x1' });
  expect(base.disconnect).not.toHaveBeenCalled();
});

test('allows retry after cancellation', async () => {
  const { connector, base, result } = setup();
  base.connect.mockRejectedValueOnce(new Error('cancelled'));
  await expect(connector.connect()).rejects.toThrow('cancelled');
  expect(await connector.connect()).toEqual(result);
  await connector.onConnect({ chainId: '0x1' });
  expect(base.onConnect).toHaveBeenCalledTimes(1);
});

test('rejects overlapping connection attempts', async () => {
  const { connector, base, result } = setup();
  let resolve: (value: typeof result) => void = () => undefined;
  base.connect.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const first = connector.connect();
  await expect(connector.connect()).rejects.toThrow('already in progress');
  await Promise.resolve();
  await Promise.resolve();
  resolve(result);
  expect(await first).toEqual(result);
});

test('can retry provider initialization after a failure', async () => {
  const { connector, base, result } = setup();
  base.getProvider.mockRejectedValueOnce(new Error('network'));
  await expect(connector.connect()).rejects.toThrow('Unable to initialize');
  expect(await connector.connect()).toEqual(result);
});

test('clears a cancelled proposal error when a new pairing URI arrives', async () => {
  const { connector, base, result } = setup();
  const { SnackController } = await import('@reown/appkit-controllers');
  base.connect.mockImplementation(async () => {
    jest.mocked(SnackController.hide).mockClear();
    connector.onDisplayUri(uri);
    expect(SnackController.hide).toHaveBeenCalledTimes(1);
    return result;
  });
  await connector.connect();
});

test('rejects a cancelled pairing approval even after retry has started', async () => {
  const { connector, provider, base, result } = setup();
  base.connect.mockImplementationOnce(async () => {
    connector.onDisplayUri(uri);
    throw new Error('cancelled');
  });
  await expect(connector.connect()).rejects.toThrow('cancelled');
  let finish: (value: typeof result) => void = () => undefined;
  base.connect.mockImplementationOnce(() => {
    connector.onDisplayUri(`wc:${otherTopic}@2?relay-protocol=irn&symKey=${'d'.repeat(64)}`);
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const retry = connector.connect();
  // Wait for the SDK connection call, rather than assuming microtask timing.
  while (base.connect.mock.calls.length < 2) await Promise.resolve();
  provider.session = { pairingTopic: topic };
  await connector.onConnect({ chainId: '0x1' });
  expect(base.onConnect).not.toHaveBeenCalled();
  expect(base.disconnect).toHaveBeenCalledTimes(1);
  finish(result);
  await retry;
});
