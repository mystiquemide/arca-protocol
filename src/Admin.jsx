import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { arcaApi } from './lib/api';
import { formatAddress, getPolicies, triggerPolicyPayout } from './lib/policies';

const badgeColors = {
  flight: 'bg-blue-500/10 text-blue-400',
  weather: 'bg-emerald-500/10 text-emerald-300',
  logistics: 'bg-yellow-500/10 text-yellow-400',
};

const readinessTone = {
  ready: 'border-[#a9ddd3]/30 bg-[#a9ddd3]/10 text-[#a9ddd3]',
  partial: 'border-yellow-400/30 bg-yellow-400/10 text-yellow-200',
  blocked: 'border-red-400/30 bg-red-400/10 text-red-200',
};

const ProviderTile = ({ label, detail, status, tone = 'partial', meta, metrics = [] }) => (
  <div className="bg-white/5 border border-white/10 rounded-xl p-4 min-h-[132px] flex flex-col justify-between gap-4">
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-[9px] uppercase tracking-widest text-white/40">{label}</div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-widest ${readinessTone[tone]}`}>
          {status}
        </span>
      </div>
      <div className="text-sm text-[#e8e3d5] leading-relaxed">{detail}</div>
      {metrics.length > 0 && (
        <div className="mt-4 space-y-2">
          {metrics.map((metric) => (
            <div key={metric.label} className="flex justify-between gap-3 text-[10px]">
              <span className="text-white/35 uppercase tracking-widest">{metric.label}</span>
              <span className={`text-right font-mono ${metric.tone || 'text-white/55'}`}>{metric.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
    {meta && <div className="text-[10px] font-mono text-white/35 break-words">{meta}</div>}
  </div>
);

const formatDateTime = (value) => {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
};

export default function Admin() {
  const navigate = useNavigate();
  const [policies, setPolicies] = useState(() => getPolicies());
  const [triggeringId, setTriggeringId] = useState(null);
  const [usingApi, setUsingApi] = useState(false);
  const [providerStatus, setProviderStatus] = useState(null);
  const [withdrawals, setWithdrawals] = useState([]);
  const [payoutOpsBusy, setPayoutOpsBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [adminNotice, setAdminNotice] = useState('');

  useEffect(() => {
    arcaApi.listPolicies()
      .then((apiPolicies) => {
        setPolicies(apiPolicies);
        setUsingApi(true);
      })
      .catch((error) => {
        console.warn('API admin load failed, using local fallback:', error);
        setPolicies(getPolicies());
        setUsingApi(false);
      });

    arcaApi.getProviderStatus()
      .then(setProviderStatus)
      .catch((error) => {
        console.warn('Provider status load failed:', error);
        setProviderStatus(null);
      });

    arcaApi.listWithdrawals()
      .then(setWithdrawals)
      .catch((error) => {
        console.warn('Withdrawal ops load failed:', error);
        setWithdrawals([]);
      });
  }, []);

  const refreshPayoutOps = async () => {
    setPayoutOpsBusy(true);
    try {
      await arcaApi.syncWithdrawals().catch(() => null);
      const [providers, rows] = await Promise.all([
        arcaApi.getProviderStatus(),
        arcaApi.listWithdrawals(),
      ]);
      setProviderStatus(providers);
      setWithdrawals(rows);
    } catch (error) {
      console.warn('Payout ops refresh failed:', error);
    } finally {
      setPayoutOpsBusy(false);
    }
  };

  const cleanupFailedPayoutOps = async () => {
    setPayoutOpsBusy(true);
    try {
      await arcaApi.cleanupFailedWithdrawals();
      await refreshPayoutOps();
    } catch (error) {
      console.warn('Payout ops cleanup failed:', error);
      setPayoutOpsBusy(false);
    }
  };

  const reloadAdminData = async () => {
    const [apiPolicies, providers, rows] = await Promise.all([
      arcaApi.listPolicies(),
      arcaApi.getProviderStatus(),
      arcaApi.listWithdrawals(),
    ]);
    setPolicies(apiPolicies);
    setProviderStatus(providers);
    setWithdrawals(rows);
    setUsingApi(true);
  };

  const resetDemoData = async () => {
    if (!resetConfirm) {
      setResetConfirm(true);
      setAdminNotice('Click reset again to restore the seeded demo state.');
      window.setTimeout(() => setResetConfirm(false), 6000);
      return;
    }

    setResetBusy(true);
    setAdminNotice('');
    try {
      await arcaApi.resetDemoData();
      localStorage.removeItem('arca_policies');
      localStorage.removeItem('arca_withdrawal');
      localStorage.removeItem('arca_withdrawals');
      localStorage.removeItem('simulated_payout');
      localStorage.removeItem('simulated_payout_complete');
      await reloadAdminData();
      setResetConfirm(false);
      setAdminNotice('Demo state reset. Dashboard is back to the seeded flow.');
    } catch (error) {
      console.warn('Demo reset failed:', error);
      setAdminNotice('Demo reset failed. Check that the API is running.');
    } finally {
      setResetBusy(false);
    }
  };

  const triggerPayout = (policyId) => {
    setTriggeringId(policyId);
    setTimeout(async () => {
      try {
        if (usingApi) {
          const currentPolicy = policies.find((policy) => policy.id === policyId);
          const settledPolicy = currentPolicy?.category === 'weather'
            ? await arcaApi.simulateWeatherRainfall(policyId, 0)
            : currentPolicy?.category === 'logistics'
              ? await arcaApi.simulateLogisticsDelay(policyId, 72)
              : await arcaApi.simulateFlightDelay(policyId, 180);
          setPolicies((current) => current.map((policy) => policy.id === policyId ? settledPolicy : policy));
        } else {
          triggerPolicyPayout(policyId);
          localStorage.setItem('simulated_payout', policyId);
          setPolicies(getPolicies());
        }
      } catch (error) {
        console.warn('API trigger failed, using local fallback:', error);
        triggerPolicyPayout(policyId);
        localStorage.setItem('simulated_payout', policyId);
        setPolicies(getPolicies());
      }
      setTriggeringId(null);
    }, 1500);
  };

  const monitoredPolicies = policies.filter((policy) => policy.status !== 'expired');
  const activeCount = monitoredPolicies.filter((policy) => policy.status === 'active').length;
  const triggeredCount = monitoredPolicies.filter((policy) => policy.status === 'triggered').length;
  const paidCount = monitoredPolicies.filter((policy) => policy.status === 'paid').length;
  const circle = providerStatus?.circle;
  const flightaware = providerStatus?.flightaware;
  const flightawareHealth = flightaware?.health || {};
  const completedPayouts = withdrawals.filter((item) => item.status === 'complete' || item.rail_status === 'complete');
  const queuedPayouts = withdrawals.filter((item) => ['initiated', 'processing'].includes(item.status) && item.rail_status !== 'complete');
  const failedPayouts = withdrawals.filter((item) => item.status === 'failed' || item.rail_status === 'failed');
  const shortWallet = (address) => address ? `${address.slice(0, 8)}...${address.slice(-6)}` : 'No account';
  const payoutStatusLabel = (item) => {
    if (item.status === 'failed' || item.rail_status === 'failed') return 'Failed';
    if (item.status === 'complete' || item.rail_status === 'complete') return 'Completed';
    if (item.tx_hash || item.status === 'processing') return 'Processing';
    if (item.rail_status === 'ready_not_broadcast') return 'Queued';
    return 'Pending';
  };
  const providerTiles = [
    {
      label: 'Flight Data',
      detail: flightaware?.configured ? 'FlightAware AeroAPI is configured for provider-backed aviation monitoring.' : 'FlightAware key is not configured, so flight quotes use demo-safe monitoring metadata.',
      status: flightaware?.demo_delay_enabled ? 'Demo' : flightaware?.ok ? 'Feed on' : 'Pending',
      tone: flightaware?.ok ? 'ready' : 'partial',
      meta: flightaware?.base_url || 'FlightAware AeroAPI',
      metrics: [
        { label: 'Last Check', value: formatDateTime(flightawareHealth.last_checked_at) },
        { label: 'Last Success', value: formatDateTime(flightawareHealth.last_success_at), tone: flightawareHealth.last_success_at ? 'text-[#a9ddd3]' : 'text-white/35' },
        { label: 'Ident', value: flightawareHealth.last_ident || 'None' },
        { label: 'Delay', value: `${flightawareHealth.last_delay_minutes ?? 0}m` },
        ...(flightawareHealth.last_error ? [{ label: 'Error', value: flightawareHealth.last_error, tone: 'text-red-300' }] : []),
      ],
    },
    {
      label: 'Weather Data',
      detail: providerStatus?.weather?.ok ? 'Open-Meteo responded with current precipitation and weather metrics.' : 'Open-Meteo is unreachable, so weather quotes fall back to the local quote engine.',
      status: providerStatus?.weather?.ok ? 'Feed on' : 'Fallback',
      tone: providerStatus?.weather?.ok ? 'ready' : 'blocked',
      meta: providerStatus?.weather?.timezone || 'Open-Meteo',
    },
    {
      label: 'Logistics Data',
      detail: providerStatus?.logistics?.next_step || 'Carrier tracking status has not been checked yet.',
      status: 'Simulation',
      tone: providerStatus?.logistics?.ok ? 'ready' : 'blocked',
      meta: providerStatus?.logistics?.provider || 'Arca simulated carrier feed',
    },
    {
      label: 'Circle Rail',
      detail: circle?.next_step || 'Circle status has not been checked yet.',
      status: circle?.ok ? 'Internal test ready' : circle?.configured ? 'Setup' : 'Missing',
      tone: circle?.ok ? 'ready' : circle?.configured ? 'partial' : 'blocked',
      meta: circle?.base_wallet_address
        ? `${formatAddress(circle.base_wallet_address)} • ${circle.base_usdc_balance || '0'} USDC`
        : circle?.cli_version
          ? `CLI ${circle.cli_version}`
          : circle?.plugin,
    },
  ];

  return (
    <div className="relative w-full min-h-screen flex flex-col pt-24 md:pt-32 pb-24 items-center bg-[#040507]">
      <main className="z-10 w-full max-w-4xl px-4 md:px-6 animate-fade-up">
        {adminNotice && (
          <div className="mb-5 rounded-xl border border-[#a9ddd3]/20 bg-[#a9ddd3]/10 px-4 py-3 text-xs text-[#e8e3d5]/75">
            {adminNotice}
          </div>
        )}
        <div className="flex flex-col mb-10 border-b border-white/10 pb-6">
          <div className="flex justify-between items-end gap-6">
            <div>
              <div className="text-[10px] md:text-xs font-semibold tracking-widest uppercase text-red-500 mb-2 flex items-center gap-2">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                Oracle Node Command Center
              </div>
              <h1 className="text-3xl md:text-4xl font-bold text-[#e8e3d5] font-mono tracking-tight">Admin Terminal</h1>
            </div>
            <button onClick={() => navigate('/dashboard')} className="text-[10px] uppercase tracking-widest text-[#a9ddd3] hover:text-white transition-colors text-right">
              Exit to Consumer Dashboard
            </button>
          </div>
        </div>

        <div className="mb-8 rounded-xl border border-red-400/20 bg-red-400/10 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-widest font-bold text-red-200 mb-1">Demo Controls</div>
            <div className="text-xs text-[#e8e3d5]/55">Restore seeded policies, ledger, payouts, and local browser demo state before a clean walkthrough.</div>
          </div>
          <button
            type="button"
            onClick={resetDemoData}
            disabled={resetBusy}
            className={`shrink-0 rounded-md border px-4 py-2 text-[10px] uppercase tracking-widest transition-colors ${resetConfirm ? 'border-red-300/40 bg-red-400/20 text-red-100 hover:bg-red-400/30' : 'border-red-400/25 bg-red-400/10 text-red-200 hover:bg-red-400/20'} disabled:opacity-50`}
          >
            {resetBusy ? 'Resetting' : resetConfirm ? 'Confirm Reset' : 'Reset Demo'}
          </button>
        </div>

        <div className="mb-8">
          <div className="grid grid-cols-3 gap-3 mb-8">
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="text-[9px] uppercase tracking-widest text-white/40 mb-1">Active</div>
              <div className="text-2xl font-bold font-mono text-[#a9ddd3]">{activeCount}</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="text-[9px] uppercase tracking-widest text-white/40 mb-1">Triggered</div>
              <div className="text-2xl font-bold font-mono text-red-300">{triggeredCount}</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="text-[9px] uppercase tracking-widest text-white/40 mb-1">Paid</div>
              <div className="text-2xl font-bold font-mono text-[#e8e3d5]">{paidCount}</div>
            </div>
          </div>

          <div className="mb-8">
            <div className="flex items-end justify-between gap-4 mb-4">
              <h2 className="text-sm font-semibold text-[#e8e3d5]">Provider Mesh</h2>
              <div className="text-[10px] uppercase tracking-widest text-white/35">{usingApi ? 'API Online' : 'Local Fallback'}</div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {providerTiles.map((provider) => (
                <ProviderTile key={provider.label} {...provider} />
              ))}
            </div>
          </div>

          <div className="mb-8">
            <div className="flex items-end justify-between gap-4 mb-4">
              <div>
                <h2 className="text-sm font-semibold text-[#e8e3d5]">Payout Operations</h2>
                <div className="text-[10px] text-white/35 mt-1">Base USDC rail, recent receipts, and failed test cleanup.</div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={refreshPayoutOps}
                  disabled={payoutOpsBusy}
                  className="px-3 py-2 rounded-md border border-white/10 bg-white/5 text-[10px] uppercase tracking-widest text-[#a9ddd3] hover:bg-white/10 disabled:text-white/25 transition-colors"
                >
                  {payoutOpsBusy ? 'Syncing' : 'Sync'}
                </button>
                <button
                  type="button"
                  onClick={cleanupFailedPayoutOps}
                  disabled={payoutOpsBusy || failedPayouts.length === 0}
                  className="px-3 py-2 rounded-md border border-red-400/20 bg-red-400/10 text-[10px] uppercase tracking-widest text-red-200 hover:bg-red-400/15 disabled:text-white/25 disabled:border-white/10 disabled:bg-white/5 transition-colors"
                >
                  Clear Failed
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="text-[9px] uppercase tracking-widest text-white/40 mb-1">Rail Balance</div>
                <div className="text-xl font-bold font-mono text-[#a9ddd3]">{circle?.base_usdc_balance || '0'} <span className="text-xs text-white/40">USDC</span></div>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="text-[9px] uppercase tracking-widest text-white/40 mb-1">Completed</div>
                <div className="text-xl font-bold font-mono text-[#e8e3d5]">{completedPayouts.length}</div>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="text-[9px] uppercase tracking-widest text-white/40 mb-1">Queued</div>
                <div className="text-xl font-bold font-mono text-yellow-200">{queuedPayouts.length}</div>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="text-[9px] uppercase tracking-widest text-white/40 mb-1">Failed</div>
                <div className="text-xl font-bold font-mono text-red-300">{failedPayouts.length}</div>
              </div>
            </div>

            <div className="bg-[#040507] rounded-xl border border-white/10 overflow-hidden">
              {withdrawals.slice(0, 5).map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-4 border-b border-white/5 p-4 last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-sm text-[#e8e3d5] font-semibold truncate">{item.destination_name || 'External account'}</div>
                    <div className="text-[10px] font-mono text-white/35 mt-1">{shortWallet(item.destination_wallet_address)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-mono text-[#e8e3d5]">{Number(item.amount).toFixed(2)} USDC</div>
                    <div className={`text-[10px] uppercase tracking-widest mt-1 ${payoutStatusLabel(item) === 'Failed' ? 'text-red-300' : payoutStatusLabel(item) === 'Completed' ? 'text-[#a9ddd3]' : 'text-yellow-200'}`}>
                      {payoutStatusLabel(item)}
                    </div>
                  </div>
                </div>
              ))}
              {withdrawals.length === 0 && (
                <div className="p-6 text-center text-xs text-white/40">No payout records yet.</div>
              )}
            </div>
          </div>

          <h2 className="text-sm font-semibold text-[#e8e3d5] mb-4">Policy Monitoring Queue</h2>

          {monitoredPolicies.length === 0 ? (
            <div className="bg-[#040507] rounded-xl border border-dashed border-white/10 p-8 text-center">
              <div className="text-sm text-[#e8e3d5] font-semibold mb-1">No active contracts to monitor</div>
              <div className="text-xs text-white/40">Create a new policy from the quote flow to register it here.</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {monitoredPolicies.map((policy) => {
                const triggered = policy.status === 'triggered';
                const paid = policy.status === 'paid';
                return (
                  <div key={policy.id} className="bg-[#040507] rounded-xl border border-white/10 overflow-hidden shadow-2xl relative">
                    <div className={`absolute top-0 left-0 w-full h-1 ${policy.category === 'logistics' ? 'bg-yellow-500/50' : policy.category === 'weather' ? 'bg-emerald-500/50' : 'bg-blue-500/50'}`}></div>
                    <div className="p-5">
                      <div className="flex justify-between items-center gap-4 mb-4">
                        <div className="text-sm font-mono text-[#e8e3d5] truncate">Contract: {formatAddress(policy.contractAddress)}</div>
                        <div className={`text-[10px] px-2 py-1 rounded font-bold uppercase tracking-widest ${badgeColors[policy.category] || badgeColors.flight}`}>{policy.badge}</div>
                      </div>

                      <div className="space-y-3 mb-6">
                        <div className="flex justify-between gap-4 text-xs">
                          <span className="text-white/40">Data Source</span>
                          <span className="text-white text-right">{policy.source}</span>
                        </div>
                        <div className="flex justify-between gap-4 text-xs">
                          <span className="text-white/40">Target Event</span>
                          <span className="text-white text-right">{policy.target}</span>
                        </div>
                        <div className="flex justify-between gap-4 text-xs">
                          <span className="text-white/40">Trigger Condition</span>
                          <span className="text-white text-right">{policy.trigger}</span>
                        </div>
                        <div className="flex justify-between gap-4 text-xs">
                          <span className="text-white/40">Current Status</span>
                          <span className={paid ? 'text-[#a9ddd3] text-right' : triggered ? 'text-red-300 text-right' : 'text-[#a9ddd3] text-right'}>{policy.currentStatus}</span>
                        </div>
                      </div>

                      {policy.status === 'active' ? (
                        <button
                          onClick={() => triggerPayout(policy.id)}
                          disabled={triggeringId === policy.id || !['flight', 'weather', 'logistics'].includes(policy.category)}
                          className="w-full py-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-500 font-bold text-[10px] tracking-widest uppercase rounded transition-all flex justify-center items-center gap-2"
                        >
                          {triggeringId === policy.id ? (
                            <>
                              <span className="w-3 h-3 border-2 border-red-500/20 border-t-red-500 rounded-full animate-spin"></span>
                              Simulating Provider Breach...
                            </>
                          ) : policy.category === 'flight' ? 'Simulate 180m Flight Delay' : policy.category === 'weather' ? 'Simulate 0mm Rainfall' : policy.category === 'logistics' ? 'Simulate 72h Transit Delay' : 'Demo Trigger Unavailable'}
                        </button>
                      ) : paid ? (
                        <div className="w-full py-3 bg-[#a9ddd3]/10 border border-[#a9ddd3]/30 text-[#a9ddd3] font-bold text-[10px] tracking-widest uppercase rounded flex justify-center items-center gap-2">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                          Settlement Complete
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <div className="w-full py-3 bg-red-500/10 border border-red-500/30 text-red-300 font-bold text-[10px] tracking-widest uppercase rounded flex justify-center items-center gap-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                            Awaiting Dashboard Settlement
                          </div>
                          <button onClick={() => navigate('/dashboard')} className="text-[10px] text-[#a9ddd3]/70 hover:text-white uppercase tracking-widest text-center mt-2">Open Consumer Dashboard</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
