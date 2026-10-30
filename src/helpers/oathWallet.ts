import type * as AppKitControllers from '@reown/appkit-controllers';
import { walletConnect } from 'wagmi/connectors';

import oathLogo from '../assets/oath-wallet.svg';

export const OATH_WALLET = {
  id: 'oath-wallet',
  name: 'Oath Wallet',
  homepage: 'https://oathwallet.org',
  image_url: oathLogo,
  mobile_link: 'oathwallet://',
  app_store: 'https://apps.apple.com/app/id6780187283',
};

// Intersection of Compound's networks and Oath's WalletConnect transaction chains.
// Mantle, Ronin and testnets are not advertised as supported by Oath.
export const OATH_CHAIN_IDS = [1, 10, 137, 43114, 42161, 8453, 534352, 59144, 130] as const;

type Controllers = Pick<
  typeof AppKitControllers,
  'ModalController' | 'ConnectionController' | 'RouterController' | 'SnackController'
>;

export function presentOathWallet({
  ModalController,
  ConnectionController,
  RouterController,
  SnackController,
}: Controllers): () => void {
  ConnectionController.resetUri();
  SnackController.hide();
  const showOath = () => {
    if (ModalController.state.open) RouterController.reset('ConnectingWalletConnect', { wallet: OATH_WALLET });
  };
  const unsubscribe = [
    ModalController.subscribeKey('open', (open) => {
      if (open) showOath();
    }),
    RouterController.subscribeKey('view', (view) => {
      if (view === 'ConnectingWalletConnectBasic') showOath();
    }),
  ];
  return () => {
    unsubscribe.forEach((dispose) => dispose());
    ConnectionController.resetUri();
    RouterController.reset('Connect');
  };
}

export function oathWallet({ projectId }: { projectId: string }) {
  const factory = walletConnect({
    projectId,
    customStoragePrefix: 'compound-oath',
    logger: 'silent',
    telemetryEnabled: false,
    metadata: {
      name: 'Compound III',
      description: 'Compound III',
      url: 'https://app.compound.finance',
      icons: [],
    },
  });
  let connecting = false;
  let cancelled = false;
  const cancelledPairings = new Set<string>();
  let pairingTopic: string | undefined;
  let clearStaleError: (() => void) | undefined;

  const create: typeof factory = (config) => {
    const chains = config.chains.filter((chain) => OATH_CHAIN_IDS.some((id) => id === chain.id));
    if (!chains.length) throw new Error('No supported Oath networks configured');
    const base = factory({ ...config, chains: [chains[0], ...chains.slice(1)] });
    const connector: ReturnType<typeof factory> = {
      ...base,
      // Spreading the base materializes its getter before our id override.
      requestedChainsStorageKey: `${OATH_WALLET.id}.requestedChains`,
      id: OATH_WALLET.id,
      name: OATH_WALLET.name,
      icon: oathLogo,
      async connect<withCapabilities extends boolean = false>(
        parameters: {
          chainId?: number;
          isReconnecting?: boolean;
          pairingTopic?: string;
          withCapabilities?: withCapabilities | boolean;
        } = {},
      ) {
        if (connecting) throw new Error('Oath connection already in progress');
        connecting = true;
        cancelled = false;
        pairingTopic = undefined;
        let dispose: (() => void) | undefined;
        const provider = await this.getProvider().catch(() => undefined);
        try {
          if (!provider) throw new Error('Unable to initialize Oath connection');
          if (!parameters.isReconnecting && !provider.session) {
            // Match the AppKit version used by Wagmi's EthereumProvider.
            const controllers = await import('@reown/appkit-controllers');
            clearStaleError = () => controllers.SnackController.hide();
            dispose = presentOathWallet(controllers);
          }
          const connect = base.connect.bind(this) as typeof base.connect;
          return await connect<withCapabilities>(parameters);
        } catch (error) {
          cancelled = true;
          // The SDK's abortPairingAttempt is a no-op. Expire this attempt's
          // proposals and pairing so a closed QR cannot reconnect later.
          if (provider && pairingTopic) {
            cancelledPairings.add(pairingTopic);
            for (const proposal of provider.signer.client.proposal.getAll()) {
              if (proposal.pairingTopic === pairingTopic) provider.signer.client.core.expirer.set(proposal.id, 0);
            }
            await provider.signer.client.core.pairing.disconnect({ topic: pairingTopic }).catch(() => undefined);
            if (provider.session?.pairingTopic === pairingTopic) await base.disconnect.call(this);
          }
          throw error;
        } finally {
          dispose?.();
          connecting = false;
          clearStaleError = undefined;
        }
      },
      onDisplayUri(uri: string) {
        // A new QR supersedes any error toast left by a cancelled proposal.
        clearStaleError?.();
        pairingTopic = /^wc:([a-f0-9]{64})@2\?/i.exec(uri)?.[1];
        base.onDisplayUri.call(this, uri);
      },
      async onConnect(info) {
        const provider = await this.getProvider();
        const approvedPairing = provider.session?.pairingTopic;
        if (cancelled || (approvedPairing && cancelledPairings.has(approvedPairing))) {
          if (approvedPairing && cancelledPairings.has(approvedPairing)) {
            await base.disconnect.call(this);
          }
          return;
        }
        return base.onConnect.call(this, info);
      },
    };
    return connector;
  };
  return create;
}
