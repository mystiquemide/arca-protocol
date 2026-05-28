import { useNavigate } from 'react-router-dom';
import { usePrivy } from '@privy-io/react-auth';
import { useCallback, useEffect, useState } from 'react';
import { arcaApi, getLocalDashboardData } from './lib/api';
import PayoutsPanel from './PayoutsPanel';
import {
  completePolicyPayout,
  formatAddress,
  formatDate,
  formatUsdc,
  getLedgerActivity,
  getPolicyBalance,
  getPolicies,
  getTriggeredPolicy,
} from './lib/policies';

const categoryIcon = {
  flight: 'M12 19l9 2-9-18-9 18 9-2zm0 0v-8',
  weather: 'M3 15a4 4 0 004 4h9a5 5 0 10-.9-9.9A7 7 0 103 15z',
  logistics: 'M9 17a2 2 0 11-4 0 2 2 0 014 0zm10 0a2 2 0 11-4 0 2 2 0 014 0zM3 6h11v8H3zM14 9h3l3 3v2h-6z',
};

const activityIcon = {
  premium: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 1v8m0 0v1',
  monitoring: 'M15 12a3 3 0 11-6 0 3 3 0 016 0zm6 0c-2.5 4-5.5 6-9 6s-6.5-2-9-6c2.5-4 5.5-6 9-6s6.5 2 9 6z',
  triggered: 'M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
  payout: 'M5 13l4 4L19 7',
  expired: 'M6 18L18 6M6 6l12 12',
  withdrawal: 'M12 3v12m0 0l-4-4m4 4l4-4M5 21h14',
};

const formatDateTime = (value) => {
  if (!value) return 'Not checked yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not checked yet';

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = usePrivy();
  const [avatar, setAvatar] = useState(() => localStorage.getItem('user_avatar') || null);
  const [policies, setPolicies] = useState(() => getPolicies());
  const [triggeredPolicy, setTriggeredPolicy] = useState(() => getTriggeredPolicy());
  const [activity, setActivity] = useState(() => getLedgerActivity(getPolicies()));
  const [balance, setBalance] = useState(() => getPolicyBalance(getPolicies()));
  const [usingApi, setUsingApi] = useState(false);
  const [dashboardStatus, setDashboardStatus] = useState({ loading: false, error: '' });

  const loadDashboard = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setDashboardStatus({ loading: true, error: '' });
    try {
      await Promise.all([
        arcaApi.syncPolicies().catch(() => null),
        arcaApi.syncWithdrawals().catch(() => null),
      ]);
      const [apiPolicies, apiBalance, apiActivity] = await Promise.all([
        arcaApi.listPolicies(),
        arcaApi.getBalance(),
        arcaApi.getLedger(),
      ]);
      setPolicies(apiPolicies);
      setBalance(apiBalance.available_balance);
      setActivity(apiActivity);
      setTriggeredPolicy(apiPolicies.find((policy) => policy.status === 'triggered') || null);
      setUsingApi(true);
      setDashboardStatus({ loading: false, error: '' });
    } catch (error) {
      console.warn('API dashboard load failed, using local fallback:', error);
      const local = getLocalDashboardData();
      setPolicies(local.policies);
      setBalance(local.balance);
      setActivity(local.activity);
      setTriggeredPolicy(getTriggeredPolicy());
      setUsingApi(false);
      setDashboardStatus({
        loading: false,
        error: 'Live API is unavailable. Showing local demo data until the backend reconnects.',
      });
    }
  }, []);

  useEffect(() => {
    loadDashboard();
    const interval = window.setInterval(() => loadDashboard({ silent: true }), 30000);
    return () => window.clearInterval(interval);
  }, [loadDashboard]);

  const activePolicies = policies.filter((policy) => ['active', 'triggered'].includes(policy.status));
  const scrollToPayouts = () => document.getElementById('payouts')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const dismissPayout = () => {
    if (triggeredPolicy) {
      const settle = async () => {
        if (usingApi) {
          await arcaApi.settlePolicy(triggeredPolicy.id);
          await loadDashboard();
          setTriggeredPolicy(null);
          navigate(`/policy/${triggeredPolicy.id}`);
          return;
        }

        const paidPolicy = completePolicyPayout(triggeredPolicy.id);
        const local = getLocalDashboardData();
        setPolicies(local.policies);
        setBalance(local.balance);
        setActivity(local.activity);
        setTriggeredPolicy(null);
        localStorage.removeItem('simulated_payout');
        setDashboardStatus({ loading: false, error: '' });
        if (paidPolicy) {
          navigate(`/policy/${paidPolicy.id}`);
        }
      };

      settle().catch((error) => console.error('Payout settlement failed:', error));
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result;
        setAvatar(base64String);
        localStorage.setItem('user_avatar', base64String);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDeleteImage = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setAvatar(null);
    localStorage.removeItem('user_avatar');
  };

  return (
    <div className="relative w-full min-h-screen flex flex-col pt-24 md:pt-32 pb-24 items-center bg-[#040507]">
      {triggeredPolicy && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md px-4">
          <div className="bg-[#040507] p-8 md:p-10 rounded-2xl border border-[#a9ddd3]/40 shadow-[0_0_50px_rgba(169,221,211,0.2)] max-w-md w-full animate-fade-up text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-2 bg-[#a9ddd3]"></div>

            <div className="w-20 h-20 mx-auto bg-[#a9ddd3]/10 rounded-full flex items-center justify-center border border-[#a9ddd3]/30 mb-6">
              <svg className="w-10 h-10 text-[#a9ddd3]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            </div>

            <h2 className="text-2xl font-bold tracking-widest uppercase text-[#e8e3d5] mb-2">Policy Resolved</h2>
            <div className="text-[10px] font-mono tracking-widest text-[#a9ddd3] uppercase mb-6 bg-[#a9ddd3]/10 py-1.5 px-3 rounded inline-block">Parametric Condition Met</div>

            <p className="text-sm text-[#e8e3d5]/70 mb-6 leading-relaxed">
              Arca monitoring detected that <strong>{triggeredPolicy.target}</strong> met the policy trigger: {triggeredPolicy.trigger}. The payout record was advanced automatically.
            </p>

            <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-8 text-center">
              <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Total Payout Deposited</div>
              <div className="text-3xl font-bold font-mono text-[#a9ddd3]">+{triggeredPolicy.payout} <span className="text-sm text-[#a9ddd3]/60">USDC</span></div>
            </div>

            <button onClick={dismissPayout} className="w-full py-4 bg-[#a9ddd3] hover:bg-white text-[#040507] font-bold text-[10px] tracking-widest uppercase rounded-xl transition-all shadow-[0_4px_14px_rgba(169,221,211,0.2)]">
              View Policy Receipt
            </button>
          </div>
        </div>
      )}

      <main className="z-10 w-full max-w-5xl px-4 md:px-6 mx-auto">
        {dashboardStatus.error && (
          <div className="mb-10 rounded-xl border border-yellow-400/25 bg-yellow-400/10 p-4 text-sm text-yellow-100">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-widest font-bold text-yellow-200 mb-1">Demo fallback</div>
                <div className="text-xs text-yellow-100/80">{dashboardStatus.error}</div>
              </div>
              <button type="button" onClick={() => loadDashboard()} className="shrink-0 rounded-md border border-yellow-200/20 px-3 py-2 text-[10px] uppercase tracking-widest text-yellow-100 hover:bg-yellow-200/10 transition-colors">
                Retry
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-8 lg:gap-12 w-full mx-auto">
          {/* Left Column (Balances & Stats) */}
          <div className="w-full lg:w-1/3 flex flex-col items-center lg:items-start animate-fade-up delay-100">
            <div className="relative mb-4">
              <label className="relative w-14 h-14 rounded-full flex items-center justify-center shadow-lg cursor-pointer group overflow-hidden border border-white/10">
                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />

                {avatar ? (
                  <img src={avatar} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-white/5 flex items-center justify-center">
                    <span className="text-[#a9ddd3] font-bold text-xl uppercase">
                      {user?.email?.address ? user.email.address.charAt(0) : 'U'}
                    </span>
                  </div>
                )}

                <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                </div>
              </label>

              {avatar && (
                <button
                  onClick={handleDeleteImage}
                  className="absolute -top-1 -right-1 bg-red-500 hover:bg-red-600 text-white w-5 h-5 rounded-full flex items-center justify-center shadow-lg transition-colors z-10"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
              )}
            </div>

            <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-8 md:p-10 w-full max-w-md shadow-2xl relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#a9ddd3]/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-1000"></div>
              <div className="text-[10px] md:text-xs font-semibold tracking-widest uppercase text-[#e8e3d5]/50 mb-3 text-center">Arca Balance</div>
              <div className="text-5xl md:text-6xl font-bold text-[#e8e3d5] font-mono tracking-tight flex items-baseline justify-center gap-2">
                {formatUsdc(balance)} <span className="text-xl md:text-2xl text-[#e8e3d5]/40 font-sans tracking-normal">USDC</span>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3 text-[10px] uppercase tracking-widest text-[#e8e3d5]/35">
              <span className={usingApi ? 'text-[#a9ddd3]' : 'text-yellow-200'}>{usingApi ? 'API sync' : 'Local fallback'}</span>
              <button type="button" onClick={() => loadDashboard()} disabled={dashboardStatus.loading} className="text-[#a9ddd3]/70 hover:text-[#a9ddd3] disabled:text-[#e8e3d5]/25 transition-colors">
                {dashboardStatus.loading ? 'Refreshing' : 'Refresh'}
              </button>
            </div>
            <div className="flex gap-4 mt-8">
              <button onClick={scrollToPayouts} className="px-6 md:px-8 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs md:text-sm font-bold text-[#e8e3d5] transition-all">
                Withdraw
              </button>
              <button onClick={() => navigate('/quote')} className="px-6 md:px-8 py-3 bg-[#a9ddd3] hover:bg-white text-[#040507] rounded-xl text-xs md:text-sm font-bold transition-all shadow-[0_4px_14px_rgba(169,221,211,0.2)]">
                + New Policy
              </button>
            </div>
          </div>

          {/* Right Column (Policies & Activity) */}
          <div className="w-full lg:w-2/3 flex flex-col gap-8 lg:gap-10 animate-fade-up delay-200">
            <PayoutsPanel initialBalance={balance} onBalanceChange={setBalance} onDataChange={() => loadDashboard({ silent: true })} />

            <div>
              <h2 className="text-sm font-semibold text-[#e8e3d5] mb-4">Active Coverage</h2>

              {activePolicies.length === 0 ? (
                <button onClick={() => navigate('/quote')} className="w-full bg-[#e8e3d5]/5 rounded-2xl border border-dashed border-[#e8e3d5]/20 p-10 text-center hover:border-[#a9ddd3]/50 hover:bg-[#a9ddd3]/5 transition-all group">
                  <div className="w-12 h-12 mx-auto bg-white/5 rounded-full flex items-center justify-center mb-4 group-hover:bg-[#a9ddd3]/10 transition-colors">
                    <svg className="w-6 h-6 text-[#e8e3d5]/40 group-hover:text-[#a9ddd3] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                  </div>
                  <div className="text-sm font-semibold text-[#e8e3d5] mb-1 group-hover:text-[#a9ddd3] transition-colors">No active policies</div>
                  <div className="text-xs text-[#e8e3d5]/40">Create coverage and Arca will monitor the trigger for you.</div>
                </button>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-6">
                  {activePolicies.map((policy) => {
                    const conditionParams = policy.conditionParams || {};
                    const isFlightPolicy = policy.category === 'flight';
                    const isWeatherPolicy = policy.category === 'weather';
                    const isLogisticsPolicy = policy.category === 'logistics';
                    const providerOk = conditionParams.provider_ok;
                    const providerLabel = providerOk === false ? 'Provider Pending' : isWeatherPolicy ? 'Open-Meteo Feed' : isLogisticsPolicy ? 'Simulated Carrier Feed' : 'FlightAware Feed';

                    return (
                      <button
                        key={policy.id}
                        onClick={() => navigate(`/policy/${policy.id}`)}
                        className="w-full text-left bg-white/[0.02] rounded-2xl border border-white/[0.05] hover:border-[#a9ddd3]/40 hover:bg-white/[0.04] overflow-hidden shadow-lg p-5 transition-all duration-300 group flex flex-col justify-between"
                      >
                        <div className="flex justify-between items-center mb-4 gap-4">
                          <div className="flex items-center gap-3 md:gap-4 min-w-0">
                            <div className="w-10 h-10 md:w-12 md:h-12 bg-[#a9ddd3]/10 rounded-full flex items-center justify-center border border-[#a9ddd3]/20 shrink-0">
                              <svg className="w-5 h-5 md:w-6 md:h-6 text-[#a9ddd3]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={categoryIcon[policy.category] || categoryIcon.flight}></path></svg>
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm md:text-base font-semibold text-[#e8e3d5] truncate">{policy.type} ({policy.target})</div>
                              <div className="text-[10px] md:text-xs text-[#e8e3d5]/50 font-mono mt-0.5 truncate">{formatAddress(policy.contractAddress)} • {policy.trigger}</div>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-sm md:text-base font-bold text-[#e8e3d5]">{policy.payout} USDC</div>
                            <div className={`text-[9px] md:text-[10px] font-bold uppercase tracking-widest mt-1 flex items-center justify-end gap-1.5 px-2 py-1 rounded-full w-max ml-auto ${policy.status === 'triggered' ? 'text-red-300 bg-red-500/10' : 'text-[#a9ddd3] bg-[#a9ddd3]/10'}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${policy.status === 'triggered' ? 'bg-red-300 animate-pulse' : 'bg-[#a9ddd3] animate-ping'}`}></span>
                              {policy.status === 'triggered' ? 'Triggered' : 'Monitoring'}
                            </div>
                          </div>
                        </div>
                        <div className="h-1 w-full bg-black/60 rounded-full overflow-hidden mt-6 shadow-inner relative">
                          <div className={`h-full rounded-full opacity-90 transition-all duration-1000 ${policy.status === 'triggered' ? 'bg-red-400 w-[95%]' : 'bg-[#a9ddd3] w-[45%]'}`}></div>
                        </div>
                        <div className="mt-3 text-[10px] md:text-xs text-[#e8e3d5]/45 truncate mb-2">
                          {policy.currentStatus}
                        </div>
                        {(isFlightPolicy || isWeatherPolicy || isLogisticsPolicy) && (
                          <div className="mt-auto pt-4 border-t border-white/5 flex flex-wrap items-center justify-between gap-y-3 gap-x-4 text-[9px] md:text-[10px]">
                            <div className={`shrink-0 w-max px-2.5 py-1.5 rounded-md border font-bold uppercase tracking-widest ${providerOk === false ? 'text-amber-200 bg-amber-500/10 border-amber-300/30' : 'text-[#a9ddd3] bg-[#a9ddd3]/10 border-[#a9ddd3]/30'}`}>
                              {providerLabel}
                            </div>
                            <div className="flex flex-col items-end gap-1 text-right ml-auto">
                              <div className="text-[#e8e3d5]/40 uppercase tracking-widest">
                                Last checked: <span className="text-[#e8e3d5]/70 font-mono">{formatDateTime(conditionParams.provider_checked_at)}</span>
                              </div>
                              <div className="text-[#e8e3d5]/40 uppercase tracking-widest">
                                {isWeatherPolicy ? 'Forecast rain:' : isLogisticsPolicy ? 'Transit time:' : 'Observed delay:'} <span className="text-[#e8e3d5]/70 font-mono text-xs">{isWeatherPolicy ? `${conditionParams.forecast_precipitation_sum_mm ?? conditionParams.observed_rain_mm ?? 0}mm` : isLogisticsPolicy ? `${conditionParams.observed_transit_hours ?? 0}h` : `${conditionParams.observed_delay_minutes ?? 0}m`}</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <h2 className="text-sm font-semibold text-[#e8e3d5] mb-4">Recent Activity</h2>
              <div className="bg-[#e8e3d5]/5 rounded-2xl border border-[#e8e3d5]/10 overflow-hidden shadow-lg">
                {activity.length === 0 ? (
                  <div className="p-12 text-center flex flex-col items-center">
                    <div className="w-12 h-12 bg-black/40 rounded-full flex items-center justify-center mb-4 border border-white/5 shadow-inner">
                      <svg className="w-5 h-5 text-[#e8e3d5]/20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    </div>
                    <div className="text-sm font-semibold text-[#e8e3d5] mb-1">No activity yet</div>
                    <div className="text-xs text-[#e8e3d5]/40">Policy purchases, triggers, and payouts will appear here.</div>
                  </div>
                ) : activity.map((item, index) => {
                  const isPositive = item.tone === 'positive';
                  const isWarning = item.tone === 'warning';
                  const isMuted = item.tone === 'muted';

                  return (
                    <button
                      key={item.id}
                      onClick={() => item.policyId ? navigate(`/policy/${item.policyId}`) : scrollToPayouts()}
                      className={`w-full p-4 md:p-5 flex justify-between items-center hover:bg-white/5 transition-colors cursor-pointer text-left ${index !== activity.length - 1 ? 'border-b border-[#e8e3d5]/5' : ''} ${isPositive ? 'bg-[#a9ddd3]/5' : ''}`}
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isPositive ? 'bg-[#a9ddd3]/20 border border-[#a9ddd3]/40' : isWarning ? 'bg-red-500/10 border border-red-500/30' : 'bg-black/40 border border-white/5'}`}>
                          <svg className={`w-5 h-5 ${isPositive ? 'text-[#a9ddd3]' : isWarning ? 'text-red-300' : 'text-[#e8e3d5]/40'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={activityIcon[item.type] || activityIcon.premium}></path></svg>
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-[#e8e3d5] truncate">{item.title}</div>
                          <div className={`text-xs mt-0.5 truncate ${isPositive ? 'text-[#a9ddd3]' : isWarning ? 'text-red-300' : 'text-[#e8e3d5]/50'}`}>{formatDate(item.date)} • {item.detail}</div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`text-sm font-bold ${isPositive ? 'text-[#a9ddd3]' : isMuted ? 'text-[#e8e3d5]/40' : 'text-[#e8e3d5]'}`}>{item.amount}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
