import { usePrivy } from '@privy-io/react-auth';
import { useCallback, useEffect, useState } from 'react';
import { arcaApi, getActiveUserId } from './lib/api';
import {
  clearWithdrawal,
  formatUsdc,
  getPolicies,
  getPolicyBalance,
  getWithdrawal,
  saveWithdrawal,
} from './lib/policies';

const friendlyTransferError = (error) => {
  const message = typeof error === 'string' ? error : error?.message || '';
  if (!message) return '';
  if (message.toLowerCase().includes('fetch failed')) return 'Payout service could not be reached. No funds were sent.';
  if (message.toLowerCase().includes('invalid request body')) return 'Payout request was not accepted. No funds were sent.';
  return message
    .replace(/^Error:\s*/, '')
    .replace(/Circle transfer/gi, 'Payout')
    .replace(/Circle withdrawals/gi, 'Payouts') || 'Payout could not be sent. No funds were sent.';
};

const normalizeWithdrawal = (item) => ({
  id: item.id,
  amount: formatUsdc(item.amount),
  destination: item.destination_name || item.destination,
  destinationWallet: item.destination_wallet_address || item.destinationWallet,
  rail: item.rail,
  railStatus: item.rail_status || item.railStatus,
  txHash: item.tx_hash || item.txHash,
  status: item.status,
  createdAt: item.created_at || item.createdAt,
  error: friendlyTransferError(item.transfer_payload?.error),
});

const visibleLastPayout = (items) => items.find((item) => item.status !== 'failed' && item.railStatus !== 'failed') || items[0] || null;
const receiptNumber = (id) => `ARCA-${String(id || 'receipt').replace(/[^a-zA-Z0-9]/g, '').slice(-10).toUpperCase()}`;
const isFailedPayout = (item) => item?.status === 'failed' || item?.railStatus === 'failed';
const isCompletePayout = (item) => item?.status === 'complete' || item?.railStatus === 'complete';
const isProcessingPayout = (item) => Boolean(item?.txHash || item?.railStatus === 'broadcast' || item?.status === 'processing');
const savedWithdrawal = getWithdrawal();
const savedWithdrawals = savedWithdrawal ? [normalizeWithdrawal(savedWithdrawal)] : [];

export default function PayoutsPanel({ initialBalance, onBalanceChange, onDataChange }) {
  const { user } = usePrivy();
  const [balance, setBalance] = useState(() => initialBalance ?? getPolicyBalance(getPolicies()));
  const [withdrawAmount, setWithdrawAmount] = useState(() => initialBalance ?? getPolicyBalance(getPolicies()));
  const [withdrawal, setWithdrawal] = useState(() => visibleLastPayout(savedWithdrawals));
  const [withdrawals, setWithdrawals] = useState(() => savedWithdrawals);
  const [withdrawing, setWithdrawing] = useState(false);
  const [usingApi, setUsingApi] = useState(false);
  const [transferError, setTransferError] = useState('');
  const [pendingTransfer, setPendingTransfer] = useState(null);
  const [payoutReceipt, setPayoutReceipt] = useState(null);
  const [providerStatus, setProviderStatus] = useState(null);
  const [showFailedHistory, setShowFailedHistory] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [linkedBank, setLinkedBank] = useState(() => {
    const saved = localStorage.getItem('linked_bank');
    return saved ? JSON.parse(saved) : null;
  });
  const [showAddBank, setShowAddBank] = useState(false);
  const [bankForm, setBankForm] = useState({ name: '', wallet: '', routing: '', account: '' });

  const appWalletAddress = user?.wallet?.address || '';
  const activePayouts = withdrawals.filter((item) => !isFailedPayout(item));
  const failedPayouts = withdrawals.filter((item) => isFailedPayout(item));
  const payoutMode = providerStatus?.transfers_enabled ? 'Broadcast enabled' : 'Staged';
  const payoutReady = Boolean(providerStatus?.ok && providerStatus?.base_wallet_address);
  const txUrl = (hash) => `https://basescan.org/tx/${hash}`;
  const shortAddress = (address) => address ? `${address.slice(0, 8)}...${address.slice(-6)}` : 'Not available';
  const formatDateTime = (value) => value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
    : 'Just now';

  const transferTone = (item) => {
    if (isFailedPayout(item)) return 'text-red-300 border-red-400/30 bg-red-400/10';
    if (isCompletePayout(item)) return 'text-[#a9ddd3] border-[#a9ddd3]/30 bg-[#a9ddd3]/10';
    if (isProcessingPayout(item)) return 'text-sky-200 border-sky-400/30 bg-sky-400/10';
    return 'text-yellow-200 border-yellow-400/30 bg-yellow-400/10';
  };

  const transferLabel = (item) => {
    if (isFailedPayout(item)) return 'Failed';
    if (isCompletePayout(item)) return 'Complete';
    if (isProcessingPayout(item)) return 'Processing';
    if (item.railStatus === 'ready_not_broadcast') return 'Queued';
    return 'Pending';
  };

  const transferSummary = (item) => {
    if (isFailedPayout(item)) return item.error || 'Payout failed before funds were sent.';
    if (isCompletePayout(item)) return 'USDC transfer completed.';
    if (isProcessingPayout(item)) return item.txHash ? 'Transfer broadcast and awaiting final confirmation.' : 'Transfer submitted and awaiting confirmation.';
    if (item.railStatus === 'ready_not_broadcast') return 'Payout queued. Live broadcasts are currently disabled.';
    return item.railStatus || 'Payout request is pending.';
  };

  const receiptTitle = (item) => {
    if (isFailedPayout(item)) return `${item.amount} USDC not sent`;
    if (isCompletePayout(item)) return `${item.amount} USDC sent`;
    if (isProcessingPayout(item)) return `${item.amount} USDC processing`;
    return `${item.amount} USDC queued`;
  };

  const syncBalance = useCallback((nextBalance) => {
    setBalance(nextBalance);
    setWithdrawAmount(nextBalance);
    onBalanceChange?.(nextBalance);
  }, [onBalanceChange]);

  useEffect(() => {
    if (initialBalance === undefined || initialBalance === null) return;
    setBalance(initialBalance);
    setWithdrawAmount((current) => {
      if (!current || Number(current) > Number(initialBalance)) return initialBalance;
      return current;
    });
  }, [initialBalance]);

  const showNotice = (message, tone = 'success') => {
    setNotice({ message, tone });
    window.setTimeout(() => setNotice(null), 4200);
  };

  const refreshWithdrawals = async () => {
    setHistoryBusy(true);
    try {
      await arcaApi.syncWithdrawals().catch(() => null);
      const [apiBalance, apiWithdrawals] = await Promise.all([
        arcaApi.getBalance(),
        arcaApi.listWithdrawals(),
      ]);
      const normalizedWithdrawals = apiWithdrawals.map(normalizeWithdrawal);
      syncBalance(apiBalance.available_balance);
      setWithdrawals(normalizedWithdrawals);
      setWithdrawal(visibleLastPayout(normalizedWithdrawals));
      setUsingApi(true);
      showNotice('Payout history is up to date.');
      onDataChange?.();
    } catch (error) {
      console.warn('Payout history refresh failed:', error);
      setTransferError('Payout history could not refresh right now.');
      showNotice('Payout history could not refresh right now.', 'error');
    } finally {
      setHistoryBusy(false);
    }
  };

  useEffect(() => {
    Promise.all([
      arcaApi.getBalance(),
      arcaApi.syncWithdrawals().catch(() => null).then(() => arcaApi.listWithdrawals()),
      arcaApi.getProviderStatus().catch(() => null),
    ])
      .then(([apiBalance, apiWithdrawals, providers]) => {
        const normalizedWithdrawals = apiWithdrawals.map(normalizeWithdrawal);
        syncBalance(apiBalance.available_balance);
        setWithdrawals(normalizedWithdrawals);
        setWithdrawal(visibleLastPayout(normalizedWithdrawals));
        setProviderStatus(providers?.circle || null);
        setUsingApi(true);
      })
      .catch((error) => {
        console.warn('API payout load failed, using local fallback:', error);
        setUsingApi(false);
      });
  }, [syncBalance]);

  const cleanupFailedHistory = async () => {
    setHistoryBusy(true);
    setTransferError('');
    try {
      await arcaApi.cleanupFailedWithdrawals();
      await refreshWithdrawals();
      setShowFailedHistory(false);
      showNotice('Failed test attempts cleared.');
    } catch (error) {
      console.warn('Failed payout cleanup failed:', error);
      setTransferError('Failed attempts could not be cleared right now.');
      showNotice('Failed attempts could not be cleared right now.', 'error');
      setHistoryBusy(false);
    }
  };

  const downloadReceipt = (receipt) => {
    if (!receipt) return;
    const escapePdfText = (value) => String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const wrapLine = (line, limit = 82) => {
      const words = String(line).split(' ');
      const output = [];
      let current = '';
      words.forEach((word) => {
        if (`${current} ${word}`.trim().length > limit) {
          if (current) output.push(current);
          current = word;
          return;
        }
        current = `${current} ${word}`.trim();
      });
      if (current) output.push(current);
      return output;
    };
    const receiptLines = [
      'ARCA',
      'Payout Receipt',
      '',
      `Receipt No: ${receiptNumber(receipt.id)}`,
      `Internal ID: ${receipt.id || 'N/A'}`,
      `Amount: ${receipt.amount} USDC`,
      `Status: ${transferLabel(receipt)}`,
      `Destination: ${receipt.destination || 'External account'}`,
      `Account: ${receipt.destinationWallet || 'N/A'}`,
      `Requested: ${formatDateTime(receipt.createdAt)}`,
      'Currency: USDC',
      receipt.txHash ? `Transaction: ${receipt.txHash}` : null,
      receipt.txHash ? `BaseScan: ${txUrl(receipt.txHash)}` : null,
      '',
      `Generated: ${formatDateTime(new Date().toISOString())}`,
      'This receipt confirms an Arca payout request record. It is not a tax document.',
    ].filter((line) => line !== null).flatMap((line) => wrapLine(line));
    const textCommands = receiptLines
      .map((line, index) => `${index === 0 ? '22' : index === 1 ? '16' : '11'} Tf 0 -18 Td (${escapePdfText(line)}) Tj`)
      .join('\n');
    const content = `0.66 0.87 0.83 rg\n0 760 612 32 re f\n0.91 0.89 0.84 rg\nBT\n/F1 22 Tf\n72 740 Td\n${textCommands}\nET`;
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(pdf.length);
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => {
      pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    const blob = new Blob([pdf], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `arca-payout-receipt-${receipt.id || Date.now()}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleLinkBank = (e) => {
    e.preventDefault();
    const newBank = {
      name: bankForm.name || 'External Wallet',
      account: bankForm.wallet.slice(-4) || bankForm.routing.slice(-4) || '0000',
      wallet: bankForm.wallet,
      iban: bankForm.routing || 'GB82WEST12345698765432',
      swift: bankForm.account || 'ARCAUSDC',
      initial: (bankForm.name || 'B').charAt(0).toUpperCase(),
    };
    setLinkedBank(newBank);
    localStorage.setItem('linked_bank', JSON.stringify(newBank));
    setShowAddBank(false);
  };

  const handleUseArcaAccount = () => {
    if (!appWalletAddress) return;
    const destination = {
      name: 'My Arca account',
      account: appWalletAddress.slice(-4),
      wallet: appWalletAddress,
      iban: 'ARCA-APP-WALLET',
      swift: 'ARCAUSDC',
      initial: 'A',
      type: 'app_wallet',
    };
    setLinkedBank(destination);
    localStorage.setItem('linked_bank', JSON.stringify(destination));
    setShowAddBank(false);
  };

  const handleWithdraw = () => {
    const amountToWithdraw = Math.min(Number(withdrawAmount || 0), balance);
    if (amountToWithdraw <= 0 || balance <= 0 || !linkedBank) return;
    setTransferError('');
    setPendingTransfer({ amount: amountToWithdraw, destination: linkedBank });
  };

  const executeWithdraw = () => {
    const amountToWithdraw = Math.min(Number(pendingTransfer?.amount || 0), balance);
    if (amountToWithdraw <= 0 || balance <= 0 || !linkedBank) return;
    setWithdrawing(true);
    setTransferError('');
    setPendingTransfer(null);
    setTimeout(() => {
      const finishLocalWithdrawal = () => {
        const nextWithdrawal = {
          id: `withdrawal_${Date.now()}`,
          amount: formatUsdc(amountToWithdraw),
          destination: linkedBank.name,
          destinationWallet: linkedBank.wallet,
          rail: linkedBank.wallet ? 'circle' : 'bank',
          railStatus: linkedBank.wallet ? 'ready_not_broadcast' : 'fiat_pending',
          status: 'initiated',
          createdAt: new Date().toISOString(),
        };
        saveWithdrawal(nextWithdrawal);
        setWithdrawal(nextWithdrawal);
        setWithdrawals((current) => [nextWithdrawal, ...current]);
        const nextBalance = getPolicyBalance(getPolicies());
        syncBalance(nextBalance);
        onDataChange?.();
        setWithdrawing(false);
        setTransferError('');
      };

      if (usingApi || linkedBank.wallet) {
        arcaApi.createWithdrawal({
          user_id: getActiveUserId(),
          amount: amountToWithdraw,
          destination_name: linkedBank.name,
          destination_iban: linkedBank.iban || 'GB82WEST12345698765432',
          destination_swift: linkedBank.swift || 'DEUTDEFF',
          destination_wallet_address: linkedBank.wallet || null,
          destination_chain: 'BASE',
        }).then((apiWithdrawal) => {
          const normalizedWithdrawal = normalizeWithdrawal(apiWithdrawal);
          if (normalizedWithdrawal.status === 'failed') {
            setTransferError(normalizedWithdrawal.error);
            showNotice(normalizedWithdrawal.error || 'Payout could not be sent.', 'error');
          } else {
            setPayoutReceipt(normalizedWithdrawal);
            showNotice(isCompletePayout(normalizedWithdrawal) ? 'Payout completed. Receipt is ready.' : 'Payout submitted. Receipt is ready.');
          }
          return Promise.all([arcaApi.getBalance(), arcaApi.listWithdrawals(), Promise.resolve(normalizedWithdrawal.id)]);
        }).then(([apiBalance, apiWithdrawals, createdWithdrawalId]) => {
          const normalizedWithdrawals = apiWithdrawals.map(normalizeWithdrawal);
          const latestReceipt = normalizedWithdrawals.find((item) => item.id === createdWithdrawalId);
          syncBalance(apiBalance.available_balance);
          setWithdrawals(normalizedWithdrawals);
          setWithdrawal(visibleLastPayout(normalizedWithdrawals));
          if (latestReceipt && !isFailedPayout(latestReceipt)) setPayoutReceipt(latestReceipt);
          onDataChange?.();
          setWithdrawing(false);
          if (normalizedWithdrawals[0]?.status !== 'failed') setTransferError('');
        }).catch((error) => {
          console.warn('API payout failed:', error);
          setWithdrawing(false);
          if (linkedBank.wallet) {
            setTransferError(friendlyTransferError(error));
            showNotice('Payout service is unavailable right now.', 'error');
            setUsingApi(false);
            return;
          }
          finishLocalWithdrawal();
        });
        return;
      }

      if (linkedBank.wallet) {
        setWithdrawing(false);
        setTransferError('Payout service is unavailable right now. No funds were sent.');
        showNotice('Payout service is unavailable right now.', 'error');
        return;
      }

      finishLocalWithdrawal();
    }, 2500);
  };

  const handleRemoveBank = () => {
    setLinkedBank(null);
    localStorage.removeItem('linked_bank');
    if (!usingApi) {
      clearWithdrawal();
      setWithdrawal(null);
      setWithdrawals([]);
      syncBalance(getPolicyBalance(getPolicies()));
      return;
    }
    setWithdrawal(null);
  };

  const renderPayoutItem = (item) => (
    <div key={item.id} className="bg-[#040507]/40 border border-[#e8e3d5]/5 rounded-xl p-4">
      <div className="flex justify-between gap-4 mb-2">
        <div>
          <div className="text-sm font-semibold text-[#e8e3d5]">{item.destination || 'External Account'}</div>
          <div className="text-[10px] font-mono text-[#e8e3d5]/40 mt-1">
            {item.destinationWallet ? shortAddress(item.destinationWallet) : 'Bank account'}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-mono text-[#e8e3d5]">{item.amount} USDC</div>
          <div className={`text-[10px] uppercase tracking-widest mt-1 ${isFailedPayout(item) ? 'text-red-300' : isCompletePayout(item) ? 'text-[#a9ddd3]' : isProcessingPayout(item) ? 'text-sky-200' : 'text-yellow-200'}`}>
            {transferLabel(item)}
          </div>
        </div>
      </div>
      <div className="text-[10px] text-[#e8e3d5]/35">
        <div className="mb-3">{transferSummary(item)}</div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setPayoutReceipt(item)} className="text-[#a9ddd3] hover:text-white transition-colors">View receipt</button>
          <button type="button" onClick={() => downloadReceipt(item)} className="text-[#e8e3d5]/45 hover:text-white transition-colors">Download PDF</button>
          {item.txHash && (
            <a href={txUrl(item.txHash)} target="_blank" rel="noreferrer" className="text-[#e8e3d5]/45 hover:text-white break-all transition-colors">View on BaseScan</a>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <section id="payouts" className="relative mb-8 bg-[#e8e3d5]/5 rounded-2xl border border-[#e8e3d5]/10 overflow-hidden shadow-lg">
      {notice && (
        <div className={`fixed top-24 right-4 z-[60] max-w-sm rounded-xl border px-4 py-3 text-xs shadow-2xl ${notice.tone === 'error' ? 'border-red-400/30 bg-red-400/15 text-red-100' : 'border-[#a9ddd3]/30 bg-[#a9ddd3]/15 text-[#e8e3d5]'}`}>
          {notice.message}
        </div>
      )}
      <div className="p-6 border-b border-[#e8e3d5]/10">
        <h2 className="text-sm font-medium text-[#e8e3d5]/70 mb-1">Payouts</h2>
        <p className="text-xs text-[#e8e3d5]/40">Choose where Arca should send claim payouts and review receipts.</p>
      </div>
      <div className="p-6">
        <div className={`border rounded-xl p-4 mb-6 ${payoutReady ? 'bg-[#a9ddd3]/10 border-[#a9ddd3]/20' : 'bg-yellow-400/10 border-yellow-400/20'}`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className={`text-[10px] uppercase tracking-widest font-bold mb-1 ${payoutReady ? 'text-[#a9ddd3]' : 'text-yellow-200'}`}>
                {payoutReady ? `Payouts ${payoutMode}` : 'Payouts checking'}
              </div>
              <div className="text-sm text-[#e8e3d5] font-semibold">
                {payoutReady ? 'Arca can send payouts to saved accounts during internal testing.' : 'Payout service is warming up.'}
              </div>
              <div className="text-xs text-[#e8e3d5]/45 mt-1">Payout currency: USDC</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-widest text-[#e8e3d5]/35 mb-1">Available</div>
              <div className="text-sm font-mono text-[#e8e3d5]">{providerStatus?.base_usdc_balance || '--'} USDC</div>
            </div>
          </div>
        </div>

        <div className="bg-[#040507]/40 border border-[#e8e3d5]/5 rounded-xl p-4 mb-6">
          <div className="flex justify-between items-start gap-4 mb-4">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[#e8e3d5]/40 mb-1">Available payout balance</div>
              <div className="text-2xl font-bold font-mono text-[#e8e3d5]">{formatUsdc(balance)} <span className="text-sm text-[#e8e3d5]/40">USDC</span></div>
            </div>
            {withdrawal && (
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-widest text-[#a9ddd3] font-bold">Last payout</div>
                <div className={`text-xs mt-1 ${isFailedPayout(withdrawal) ? 'text-red-300' : 'text-[#e8e3d5]/40'}`}>{withdrawal.amount} USDC</div>
                <div className="text-[10px] uppercase tracking-widest text-[#e8e3d5]/30 mt-1">{transferLabel(withdrawal)}</div>
              </div>
            )}
          </div>
          <label className="text-[10px] uppercase tracking-widest text-[#e8e3d5]/40 mb-1 block">Amount to send</label>
          <input
            type="number"
            min="0.01"
            max={balance}
            step="0.01"
            value={withdrawAmount}
            onChange={e => setWithdrawAmount(e.target.value)}
            disabled={balance <= 0}
            className="w-full bg-[#040507]/60 border border-[#e8e3d5]/10 rounded-md p-2.5 text-[#e8e3d5] disabled:text-white/30 text-sm font-mono focus:outline-none focus:border-[#a9ddd3]"
          />
        </div>

        {!linkedBank ? (
          <>
            {!showAddBank ? (
              <div className="space-y-3 mb-4">
                <button type="button" onClick={handleUseArcaAccount} disabled={!appWalletAddress} className="w-full text-left p-4 rounded-xl border border-[#a9ddd3]/20 bg-[#a9ddd3]/10 hover:bg-[#a9ddd3]/15 disabled:bg-white/5 disabled:border-white/10 disabled:cursor-not-allowed transition-all">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-[#e8e3d5]">Send to my Arca account</div>
                      <div className="text-xs text-[#e8e3d5]/45 mt-1">{appWalletAddress ? shortAddress(appWalletAddress) : 'Built-in payout accounts are coming soon.'}</div>
                    </div>
                    <div className={`text-[10px] uppercase tracking-widest ${appWalletAddress ? 'text-[#a9ddd3]' : 'text-[#e8e3d5]/35'}`}>{appWalletAddress ? 'Recommended' : 'Coming soon'}</div>
                  </div>
                </button>
                <button type="button" onClick={() => setShowAddBank(true)} className="w-full text-left p-4 rounded-xl border border-[#e8e3d5]/10 bg-[#040507]/40 hover:border-[#a9ddd3]/40 hover:bg-[#a9ddd3]/5 transition-all">
                  <div className="text-sm font-semibold text-[#e8e3d5]">Send to another account</div>
                  <div className="text-xs text-[#e8e3d5]/45 mt-1">Add a Base-compatible payout address you control.</div>
                </button>
              </div>
            ) : (
              <form onSubmit={handleLinkBank} className="bg-[#040507]/40 p-4 md:p-5 rounded-xl border border-[#e8e3d5]/10 mb-6 animate-fade-up">
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-[#e8e3d5]/40 mb-1 block">Account nickname</label>
                    <input type="text" placeholder="e.g. Main wallet" value={bankForm.name} onChange={e => setBankForm({ ...bankForm, name: e.target.value })} className="w-full bg-[#040507]/60 border border-[#e8e3d5]/10 rounded-md p-2.5 text-[#e8e3d5] text-sm focus:outline-none focus:border-[#a9ddd3]" required />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-[#e8e3d5]/40 mb-1 block">Receiving address</label>
                    <input type="text" placeholder="0x..." value={bankForm.wallet} onChange={e => setBankForm({ ...bankForm, wallet: e.target.value })} className="w-full bg-[#040507]/60 border border-[#e8e3d5]/10 rounded-md p-2.5 text-[#e8e3d5] text-sm font-mono focus:outline-none focus:border-[#a9ddd3]" required pattern="^0x[a-fA-F0-9]{40}$" />
                    <div className="text-[10px] text-[#e8e3d5]/35 mt-2">Use a Base-compatible address. Arca sends USDC to this account.</div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] uppercase tracking-widest text-[#e8e3d5]/40 mb-1 block">Reference</label>
                      <input type="text" placeholder="Optional" value={bankForm.routing} onChange={e => setBankForm({ ...bankForm, routing: e.target.value })} className="w-full bg-[#040507]/60 border border-[#e8e3d5]/10 rounded-md p-2.5 text-[#e8e3d5] text-sm focus:outline-none focus:border-[#a9ddd3]" />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-widest text-[#e8e3d5]/40 mb-1 block">Payout rail</label>
                      <input type="text" placeholder="Optional" value={bankForm.account} onChange={e => setBankForm({ ...bankForm, account: e.target.value })} className="w-full bg-[#040507]/60 border border-[#e8e3d5]/10 rounded-md p-2.5 text-[#e8e3d5] text-sm focus:outline-none focus:border-[#a9ddd3]" />
                    </div>
                  </div>
                  <div className="flex gap-3 mt-2">
                    <button type="button" onClick={() => setShowAddBank(false)} className="flex-1 py-2.5 border border-[#e8e3d5]/10 hover:bg-white/5 text-[#e8e3d5]/60 text-xs font-bold uppercase tracking-widest rounded-md transition-all">Cancel</button>
                    <button type="submit" className="flex-1 py-2.5 bg-[#a9ddd3] hover:bg-white text-[#040507] text-xs font-bold uppercase tracking-widest rounded-md transition-all">Save account</button>
                  </div>
                </div>
              </form>
            )}
            <button disabled className="w-full py-3.5 bg-white/5 border border-white/10 text-white/30 font-semibold text-sm rounded-xl cursor-not-allowed">
              {balance > 0 ? 'Choose a payout destination' : 'No payout balance available'}
            </button>
          </>
        ) : (
          <>
            <div className="flex justify-between items-center bg-[#040507]/40 p-4 rounded-xl border border-[#e8e3d5]/5 mb-6">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-md">
                  <span className="text-[#040507] font-bold text-lg">{linkedBank.initial}</span>
                </div>
                <div>
                  <div className="text-[#e8e3d5] text-sm font-medium">{linkedBank.name}</div>
                  <div className="text-[#e8e3d5]/50 text-xs mt-0.5 font-mono">Account ending {linkedBank.account}</div>
                </div>
              </div>
              <button onClick={handleRemoveBank} className="text-xs font-medium text-[#a9ddd3]/70 hover:text-[#a9ddd3] transition-colors">Change</button>
            </div>

            <div className="space-y-3">
              {transferError && <div className="w-full border border-red-400/30 bg-red-400/10 text-red-200 text-xs rounded-xl p-3">{transferError}</div>}
              {withdrawal && (
                <div className={`w-full border font-semibold text-sm rounded-xl p-4 ${transferTone(withdrawal)}`}>
                  <div className="flex justify-center items-center gap-2">
                    {isFailedPayout(withdrawal) ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M5 19h14L12 5 5 19z"></path></svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                    )}
                    Last payout: {withdrawal.amount} USDC
                  </div>
                  {withdrawal.rail === 'circle' && (
                    <div className="text-center text-[10px] font-mono opacity-80 mt-2">
                      {transferSummary(withdrawal)}
                    </div>
                  )}
                  <div className="mt-3 flex justify-center gap-3 text-[10px] uppercase tracking-widest">
                    <button type="button" onClick={() => setPayoutReceipt(withdrawal)} className="text-current opacity-80 hover:opacity-100 transition-opacity">Receipt</button>
                    {withdrawal.txHash && <a href={txUrl(withdrawal.txHash)} target="_blank" rel="noreferrer" className="text-current opacity-80 hover:opacity-100 transition-opacity">BaseScan</a>}
                  </div>
                </div>
              )}
              <button onClick={handleWithdraw} disabled={withdrawing || balance <= 0 || Number(withdrawAmount || 0) <= 0 || Number(withdrawAmount || 0) > balance} className="w-full py-3.5 bg-[#a9ddd3] hover:bg-white disabled:bg-white/5 disabled:text-white/30 text-[#040507] font-semibold text-sm rounded-xl transition-all shadow-[0_4px_14px_rgba(169,221,211,0.2)] flex justify-center items-center gap-2">
                {withdrawing ? (
                  <>
                    <span className="w-4 h-4 border-2 border-[#040507]/20 border-t-[#040507] rounded-full animate-spin"></span>
                    Sending payout...
                  </>
                ) : (
                  balance > 0 ? `Send ${formatUsdc(withdrawAmount)} USDC to ${linkedBank.name}` : 'No payout balance available'
                )}
              </button>
            </div>
          </>
        )}

        {withdrawals.length > 0 && (
          <div className="mt-8">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-[#e8e3d5]/60 uppercase tracking-widest">Payout history</h3>
              <button type="button" onClick={refreshWithdrawals} disabled={historyBusy} className="text-[10px] text-[#a9ddd3]/70 hover:text-[#a9ddd3] disabled:text-[#e8e3d5]/25 uppercase tracking-widest transition-colors">
                {historyBusy ? 'Refreshing' : `${activePayouts.length} visible · Refresh`}
              </button>
            </div>
            <div className="space-y-3">
              {activePayouts.map(renderPayoutItem)}
              {activePayouts.length === 0 && <div className="bg-[#040507]/40 border border-[#e8e3d5]/5 rounded-xl p-4 text-xs text-[#e8e3d5]/45">Completed payouts will appear here.</div>}
            </div>
            {failedPayouts.length > 0 && (
              <div className="mt-4">
                <button type="button" onClick={() => setShowFailedHistory((current) => !current)} className="w-full flex items-center justify-between rounded-xl border border-[#e8e3d5]/10 bg-[#040507]/25 px-4 py-3 text-left text-xs text-[#e8e3d5]/50 hover:text-[#e8e3d5] hover:bg-white/5 transition-colors">
                  <span>Failed attempts kept for audit</span>
                  <span>{failedPayouts.length} {showFailedHistory ? 'shown' : 'hidden'}</span>
                </button>
                {showFailedHistory && (
                  <>
                    <div className="space-y-3 mt-3">{failedPayouts.map(renderPayoutItem)}</div>
                    <button type="button" onClick={cleanupFailedHistory} disabled={historyBusy} className="mt-3 w-full rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-xs font-semibold text-red-200 hover:bg-red-400/15 disabled:opacity-50 transition-colors">Clear failed test attempts</button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {pendingTransfer && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center px-4 py-6">
          <div className="w-full max-w-md bg-[#080a0b] border border-[#e8e3d5]/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-[#e8e3d5]/10">
              <div className="text-xs uppercase tracking-widest text-[#a9ddd3] font-bold mb-2">Confirm payout</div>
              <h2 className="text-xl font-semibold text-[#e8e3d5]">Send {formatUsdc(pendingTransfer.amount)} USDC?</h2>
              <p className="text-xs text-[#e8e3d5]/45 mt-2">Arca will send this payout to your selected account.</p>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex justify-between gap-4"><span className="text-xs text-[#e8e3d5]/45">Destination</span><span className="text-sm text-[#e8e3d5] text-right">{pendingTransfer.destination.name}</span></div>
              <div className="flex justify-between gap-4"><span className="text-xs text-[#e8e3d5]/45">Account</span><span className="text-xs text-[#e8e3d5] font-mono text-right">{shortAddress(pendingTransfer.destination.wallet)}</span></div>
              <div className="flex justify-between gap-4"><span className="text-xs text-[#e8e3d5]/45">Network</span><span className="text-sm text-[#e8e3d5]">Base</span></div>
              <div className="flex justify-between gap-4"><span className="text-xs text-[#e8e3d5]/45">Token</span><span className="text-sm text-[#e8e3d5]">USDC</span></div>
            </div>
            <div className="p-5 pt-0 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setPendingTransfer(null)} className="py-3 rounded-xl border border-[#e8e3d5]/10 text-[#e8e3d5]/60 text-xs font-bold uppercase tracking-widest hover:bg-white/5 transition-colors">Cancel</button>
              <button type="button" onClick={executeWithdraw} className="py-3 rounded-xl bg-[#a9ddd3] text-[#040507] text-xs font-bold uppercase tracking-widest hover:bg-white transition-colors">Send payout</button>
            </div>
          </div>
        </div>
      )}

      {payoutReceipt && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center px-4 py-6">
          <div className="w-full max-w-md bg-[#080a0b] border border-[#e8e3d5]/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-[#e8e3d5]/10">
              <div className="text-xs uppercase tracking-widest text-[#a9ddd3] font-bold mb-2">{receiptNumber(payoutReceipt.id)}</div>
              <h2 className="text-xl font-semibold text-[#e8e3d5]">{receiptTitle(payoutReceipt)}</h2>
              <p className="text-xs text-[#e8e3d5]/45 mt-2">{transferSummary(payoutReceipt)}</p>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex justify-between gap-4"><span className="text-xs text-[#e8e3d5]/45">Status</span><span className="text-sm text-[#e8e3d5]">{transferLabel(payoutReceipt)}</span></div>
              <div className="flex justify-between gap-4"><span className="text-xs text-[#e8e3d5]/45">Destination</span><span className="text-sm text-[#e8e3d5] text-right">{payoutReceipt.destination || 'External account'}</span></div>
              <div className="flex justify-between gap-4"><span className="text-xs text-[#e8e3d5]/45">Account</span><span className="text-xs text-[#e8e3d5] font-mono text-right">{shortAddress(payoutReceipt.destinationWallet)}</span></div>
              <div className="flex justify-between gap-4"><span className="text-xs text-[#e8e3d5]/45">Requested</span><span className="text-sm text-[#e8e3d5] text-right">{formatDateTime(payoutReceipt.createdAt)}</span></div>
              <div className="flex justify-between gap-4"><span className="text-xs text-[#e8e3d5]/45">Currency</span><span className="text-sm text-[#e8e3d5]">USDC</span></div>
              {payoutReceipt.txHash && <div className="flex justify-between gap-4"><span className="text-xs text-[#e8e3d5]/45">Tx hash</span><span className="text-xs text-[#e8e3d5] font-mono text-right break-all">{payoutReceipt.txHash}</span></div>}
              {payoutReceipt.txHash && <a href={txUrl(payoutReceipt.txHash)} target="_blank" rel="noreferrer" className="block rounded-xl border border-[#a9ddd3]/20 bg-[#a9ddd3]/10 p-3 text-center text-xs font-semibold text-[#a9ddd3] hover:bg-[#a9ddd3]/15 transition-colors">View on BaseScan</a>}
            </div>
            <div className="p-5 pt-0 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => downloadReceipt(payoutReceipt)} className="py-3 rounded-xl border border-[#e8e3d5]/10 text-[#e8e3d5]/70 text-xs font-bold uppercase tracking-widest hover:bg-white/5 hover:text-[#e8e3d5] transition-colors">Download</button>
              <button type="button" onClick={() => setPayoutReceipt(null)} className="py-3 rounded-xl bg-[#a9ddd3] text-[#040507] text-xs font-bold uppercase tracking-widest hover:bg-white transition-colors">Done</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
