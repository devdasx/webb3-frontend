import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';

import ConnectWalletModal from '../../src/components/ConnectWalletModal';

jest.mock('@contexts/Web3Context', () => ({
  ConnectorType: {
    Metamask: 'Metamask',
    WalletConnect: 'WalletConnect',
    Oath: 'Oath',
    WalletLink: 'WalletLink',
    Ledger: 'Ledger',
    Ronin: 'Ronin',
  },
}));
jest.mock('@helpers/Ledger', () => ({ getLedgerAddresses: jest.fn() }));
jest.mock('@helpers/oathWallet', () => ({ OATH_WALLET: { image_url: 'oath-wallet.svg' } }));
jest.mock('@helpers/urls', () => ({ TERMS_URL: 'https://v2-app.compound.finance/#terms' }));

const originalUserAgent = navigator.userAgent;
afterEach(() => Object.defineProperty(navigator, 'userAgent', { configurable: true, value: originalUserAgent }));

test('shows Oath in the first-level native wallet list and dispatches its connector', () => {
  const select = jest.fn(),
    close = jest.fn();
  render(<ConnectWalletModal isOpen onSelectConnector={select} onRequestClose={close} />);
  const oath = screen.getByRole('button', { name: 'Connect Oath Wallet' });
  const generic = screen.getByText('WalletConnect').closest('.connect-wallet-item');
  expect(oath).toHaveClass('connect-wallet-item');
  expect(generic).toBeInTheDocument();
  expect(oath.querySelector('img')).toHaveAttribute('width', '40');
  expect(oath.querySelector('img')).toHaveClass('connect-wallet-item__symbol');
  fireEvent.click(oath);
  expect(select).toHaveBeenCalledWith(['Oath']);
  expect(close).toHaveBeenCalledTimes(1);
});

test.each(['Enter', ' '])('supports keyboard activation with %s', (key) => {
  const select = jest.fn();
  render(<ConnectWalletModal isOpen onSelectConnector={select} onRequestClose={jest.fn()} />);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Connect Oath Wallet' }), { key });
  expect(select).toHaveBeenCalledWith(['Oath']);
});

test('keeps the generic WalletConnect path unchanged', () => {
  const select = jest.fn();
  render(<ConnectWalletModal isOpen onSelectConnector={select} onRequestClose={jest.fn()} />);
  fireEvent.click(screen.getByText('WalletConnect'));
  expect(select).toHaveBeenCalledWith(['WalletConnect']);
});

test('does not offer the iOS-only Oath app on Android', () => {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (Linux; Android 14)' });
  render(<ConnectWalletModal isOpen onSelectConnector={jest.fn()} onRequestClose={jest.fn()} />);
  expect(screen.queryByRole('button', { name: 'Connect Oath Wallet' })).not.toBeInTheDocument();
  expect(screen.getByText('WalletConnect')).toBeInTheDocument();
});
