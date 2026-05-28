import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { arcaApi } from './lib/api';
import { formatAddress, formatDate, getPolicies } from './lib/policies';

const statusCopy = {
  active: {
    label: 'Monitoring',
    tone: 'text-[#a9ddd3] bg-[#a9ddd3]/10 border-[#a9ddd3]/30',
    summary: 'Arca monitoring is watching the external condition and will advance the payout flow if the threshold is met.',
  },
  triggered: {
    label: 'Triggered',
    tone: 'text-red-300 bg-red-500/10 border-red-500/30',
    summary: 'The threshold has been breached. The payout transaction is queued for the consumer dashboard confirmation flow.',
  },
  paid: {
    label: 'Paid',
    tone: 'text-[#a9ddd3] bg-[#a9ddd3]/10 border-[#a9ddd3]/30',
    summary: 'This policy has resolved and the payout has been credited to the user balance.',
  },
  expired: {
    label: 'Expired',
    tone: 'text-[#e8e3d5]/50 bg-white/5 border-white/10',
    summary: 'This policy reached its expiry time without the trigger condition being met.',
  },
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

export default function PolicyDetail() {
  const navigate = useNavigate();
  const { id } = useParams();

  const localPolicy = useMemo(() => getPolicies().find((item) => item.id === id), [id]);
  const [policy, setPolicy] = useState(localPolicy || null);
  const [loading, setLoading] = useState(!localPolicy);

  useEffect(() => {
    let cancelled = false;

    const loadPolicy = () => arcaApi.getPolicy(id)
      .then((nextPolicy) => {
        if (!cancelled) setPolicy(nextPolicy);
      })
      .catch((error) => {
        console.warn('API policy detail load failed:', error);
        if (!cancelled && localPolicy) setPolicy(localPolicy);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    loadPolicy();
    const intervalId = window.setInterval(loadPolicy, 30000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [id, localPolicy]);

  if (loading) {
    return (
      <div className="relative w-full min-h-screen flex flex-col pt-24 md:pt-32 pb-24 items-center bg-[#040507]">
        <main className="z-10 w-full max-w-xl px-4 md:px-6 animate-fade-up text-center">
          <div className="bg-[#e8e3d5]/5 rounded-2xl border border-[#e8e3d5]/10 p-8">
            <div className="mx-auto mb-4 w-8 h-8 border-2 border-[#a9ddd3]/20 border-t-[#a9ddd3] rounded-full animate-spin"></div>
            <h1 className="text-xl font-bold text-[#e8e3d5]">Loading Policy</h1>
          </div>
        </main>
      </div>
    );
  }

  if (!policy) {
    return (
      <div className="relative w-full min-h-screen flex flex-col pt-24 md:pt-32 pb-24 items-center bg-[#040507]">
        <main className="z-10 w-full max-w-xl px-4 md:px-6 animate-fade-up text-center">
          <div className="bg-[#e8e3d5]/5 rounded-2xl border border-[#e8e3d5]/10 p-8">
            <h1 className="text-2xl font-bold text-[#e8e3d5] mb-2">Policy Not Found</h1>
            <p className="text-sm text-[#e8e3d5]/50 mb-6">This policy record is not available in the local demo store.</p>
            <button onClick={() => navigate('/dashboard')} className="px-6 py-3 bg-[#a9ddd3] hover:bg-white text-[#040507] rounded-xl text-xs font-bold uppercase tracking-widest transition-all">
              Back to Dashboard
            </button>
          </div>
        </main>
      </div>
    );
  }

  const status = statusCopy[policy.status] || statusCopy.active;
  const conditionParams = policy.conditionParams || {};
  const isFlightPolicy = policy.category === 'flight';
  const isWeatherPolicy = policy.category === 'weather';
  const isLogisticsPolicy = policy.category === 'logistics';
  const providerOk = conditionParams.provider_ok;
  const providerLabel = providerOk === false ? 'Provider Pending' : isWeatherPolicy ? 'Open-Meteo Feed' : isLogisticsPolicy ? 'Simulated Carrier Feed' : 'FlightAware Feed';
  const providerTone = providerOk === false
    ? 'text-amber-200 bg-amber-500/10 border-amber-300/30'
    : 'text-[#a9ddd3] bg-[#a9ddd3]/10 border-[#a9ddd3]/30';
  const observedDelay = Number(conditionParams.observed_delay_minutes ?? 0);
  const thresholdDelay = Number(conditionParams.delay_minutes ?? 120);
  const hasProviderCheck = Boolean(conditionParams.provider_checked_at);
  const thresholdMet = observedDelay >= thresholdDelay;
  const observedRain = Number(conditionParams.forecast_precipitation_sum_mm ?? conditionParams.observed_rain_mm ?? 0);
  const rainfallThreshold = Number(conditionParams.rainfall_mm ?? 10);
  const weatherThresholdMet = observedRain < rainfallThreshold;
  const observedTransitHours = Number(conditionParams.observed_transit_hours ?? 0);
  const transitThresholdHours = Number(conditionParams.max_transit_hours ?? 48);
  const logisticsThresholdMet = observedTransitHours > transitThresholdHours;

  return (
    <div className="relative w-full min-h-screen flex flex-col pt-24 md:pt-32 pb-24 items-center bg-[#040507]">
      <main className="z-10 w-full max-w-3xl px-4 md:px-6 animate-fade-up">
        <button onClick={() => navigate('/dashboard')} className="mb-8 flex items-center gap-2 text-[#e8e3d5]/50 hover:text-[#a9ddd3] text-[10px] font-bold tracking-widest uppercase transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
          Dashboard
        </button>

        <section className="bg-white/[0.02] rounded-3xl border border-white/5 overflow-hidden shadow-2xl mb-6 backdrop-blur-3xl relative">
          {/* Subtle top glow */}
          <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-[#a9ddd3]/30 to-transparent"></div>
          
          <div className="p-6 md:p-10 border-b border-dashed border-white/10">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-8">
              <div>
                <div className="text-[10px] md:text-xs font-semibold tracking-widest uppercase text-[#a9ddd3] mb-2">{policy.badge} Policy</div>
                <h1 className="text-3xl md:text-5xl font-bold text-[#e8e3d5] tracking-tight">{policy.type}</h1>
                <p className="text-[10px] text-[#e8e3d5]/40 mt-3 font-mono tracking-widest uppercase flex items-center gap-2">
                  <svg className="w-3 h-3 text-[#a9ddd3]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>
                  {formatAddress(policy.contractAddress)} on Demo Rail
                </p>
              </div>
              <div className={`w-max px-4 py-2 border rounded-full text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 shadow-inner ${status.tone}`}>
                {policy.status === 'active' && <span className="w-1.5 h-1.5 bg-[#a9ddd3] rounded-full animate-ping"></span>}
                {status.label}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-black/40 border border-white/5 rounded-2xl p-6 shadow-inner">
                <div className="text-[9px] uppercase tracking-widest text-[#e8e3d5]/40 mb-2">Premium Paid</div>
                <div className="text-3xl font-bold font-mono text-[#e8e3d5] tracking-tight">{policy.premium} <span className="text-sm text-white/40 tracking-normal">USDC</span></div>
              </div>
              <div className="bg-black/40 border border-[#a9ddd3]/20 rounded-2xl p-6 shadow-inner">
                <div className="text-[9px] uppercase tracking-widest text-[#a9ddd3]/60 mb-2">Guaranteed Payout</div>
                <div className="text-3xl font-bold font-mono text-[#a9ddd3] tracking-tight">{policy.payout} <span className="text-sm text-[#a9ddd3]/60 tracking-normal">USDC</span></div>
              </div>
            </div>
          </div>

          <div className="p-6 md:p-10 font-mono">
            <p className="text-[10px] text-[#e8e3d5]/50 leading-relaxed mb-8 uppercase tracking-widest bg-black/20 p-4 rounded-lg border border-white/5">{status.summary}</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6 text-[10px] md:text-xs">
              <div>
                <div className="text-[9px] uppercase tracking-widest text-[#e8e3d5]/30 mb-1">Target Event</div>
                <div className="text-[#e8e3d5]">{policy.target}</div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-widest text-[#e8e3d5]/30 mb-1">Trigger Condition</div>
                <div className="text-[#e8e3d5]">{policy.trigger}</div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-widest text-[#e8e3d5]/30 mb-1">Oracle Source</div>
                <div className="flex flex-wrap items-center gap-2 text-[#e8e3d5]">
                  <span>{policy.oracle}</span>
                  {(isFlightPolicy || isWeatherPolicy || isLogisticsPolicy) && (
                    <span className={`px-2 py-1 border rounded-full text-[8px] font-bold uppercase tracking-widest ${providerTone}`}>
                      {providerLabel}
                    </span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-widest text-[#e8e3d5]/30 mb-1">Current Status</div>
                <div className="text-[#a9ddd3]">{policy.currentStatus}</div>
              </div>
              {(isFlightPolicy || isWeatherPolicy || isLogisticsPolicy) && (
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-[#e8e3d5]/30 mb-1">Last Checked</div>
                  <div className="text-[#e8e3d5]">{formatDateTime(conditionParams.provider_checked_at)}</div>
                </div>
              )}
              {isFlightPolicy && (
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-[#e8e3d5]/30 mb-1">Observed Delay</div>
                  <div className="text-[#e8e3d5]">{conditionParams.observed_delay_minutes ?? 0} min</div>
                </div>
              )}
              {isWeatherPolicy && (
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-[#e8e3d5]/30 mb-1">Forecast Rainfall</div>
                  <div className="text-[#e8e3d5]">{observedRain} mm</div>
                </div>
              )}
              {isLogisticsPolicy && (
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-[#e8e3d5]/30 mb-1">Transit Time</div>
                  <div className="text-[#e8e3d5]">{observedTransitHours} h</div>
                </div>
              )}
              <div>
                <div className="text-[9px] uppercase tracking-widest text-[#e8e3d5]/30 mb-1">Created</div>
                <div className="text-[#e8e3d5]">{formatDate(policy.createdAt)}</div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-widest text-[#e8e3d5]/30 mb-1">Expires</div>
                <div className="text-[#e8e3d5]">{formatDate(policy.expiresAt)}</div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-[#e8e3d5]/5 rounded-2xl border border-[#e8e3d5]/10 p-6 md:p-8">
          <h2 className="text-sm font-semibold text-[#e8e3d5] mb-5">Execution Timeline</h2>
          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="w-2 h-2 mt-1.5 bg-[#a9ddd3] rounded-full"></div>
              <div>
                <div className="text-sm text-[#e8e3d5] font-medium">Policy created</div>
                <div className="text-xs text-[#e8e3d5]/40 mt-1">{formatDate(policy.createdAt)} • Premium locked and monitoring started on the demo rail.</div>
              </div>
            </div>
            {isFlightPolicy && hasProviderCheck && (
              <div className="flex gap-4">
                <div className="w-2 h-2 mt-1.5 bg-[#a9ddd3] rounded-full"></div>
                <div>
                  <div className="text-sm text-[#e8e3d5] font-medium">FlightAware checked</div>
                  <div className="text-xs text-[#e8e3d5]/40 mt-1">{formatDateTime(conditionParams.provider_checked_at)} • Provider-backed aviation status returned by FlightAware AeroAPI.</div>
                </div>
              </div>
            )}
            {isFlightPolicy && hasProviderCheck && (
              <div className="flex gap-4">
                <div className="w-2 h-2 mt-1.5 bg-[#e8e3d5]/40 rounded-full"></div>
                <div>
                  <div className="text-sm text-[#e8e3d5] font-medium">Delay observed</div>
                  <div className="text-xs text-[#e8e3d5]/40 mt-1">{observedDelay} minutes observed • Flight status: {conditionParams.flight_status || 'Scheduled'}.</div>
                </div>
              </div>
            )}
            {isFlightPolicy && hasProviderCheck && policy.status === 'active' && !thresholdMet && (
              <div className="flex gap-4">
                <div className="w-2 h-2 mt-1.5 bg-amber-200 rounded-full"></div>
                <div>
                  <div className="text-sm text-[#e8e3d5] font-medium">Threshold not met</div>
                  <div className="text-xs text-[#e8e3d5]/40 mt-1">Observed delay is below the {thresholdDelay} minute payout trigger.</div>
                </div>
              </div>
            )}
            {isWeatherPolicy && hasProviderCheck && (
              <div className="flex gap-4">
                <div className="w-2 h-2 mt-1.5 bg-[#a9ddd3] rounded-full"></div>
                <div>
                  <div className="text-sm text-[#e8e3d5] font-medium">Open-Meteo checked</div>
                  <div className="text-xs text-[#e8e3d5]/40 mt-1">{formatDateTime(conditionParams.provider_checked_at)} • Forecast precipitation returned by Open-Meteo.</div>
                </div>
              </div>
            )}
            {isWeatherPolicy && hasProviderCheck && (
              <div className="flex gap-4">
                <div className="w-2 h-2 mt-1.5 bg-[#e8e3d5]/40 rounded-full"></div>
                <div>
                  <div className="text-sm text-[#e8e3d5] font-medium">Rainfall observed</div>
                  <div className="text-xs text-[#e8e3d5]/40 mt-1">{observedRain}mm forecast precipitation • Trigger threshold: below {rainfallThreshold}mm.</div>
                </div>
              </div>
            )}
            {isWeatherPolicy && hasProviderCheck && policy.status === 'active' && !weatherThresholdMet && (
              <div className="flex gap-4">
                <div className="w-2 h-2 mt-1.5 bg-amber-200 rounded-full"></div>
                <div>
                  <div className="text-sm text-[#e8e3d5] font-medium">Threshold not met</div>
                  <div className="text-xs text-[#e8e3d5]/40 mt-1">Forecast rainfall is not below the {rainfallThreshold}mm payout trigger.</div>
                </div>
              </div>
            )}
            {isLogisticsPolicy && hasProviderCheck && (
              <div className="flex gap-4">
                <div className="w-2 h-2 mt-1.5 bg-[#a9ddd3] rounded-full"></div>
                <div>
                  <div className="text-sm text-[#e8e3d5] font-medium">Carrier feed checked</div>
                  <div className="text-xs text-[#e8e3d5]/40 mt-1">{formatDateTime(conditionParams.provider_checked_at)} • Simulated shipment SLA status returned by the Arca logistics feed.</div>
                </div>
              </div>
            )}
            {isLogisticsPolicy && hasProviderCheck && (
              <div className="flex gap-4">
                <div className="w-2 h-2 mt-1.5 bg-[#e8e3d5]/40 rounded-full"></div>
                <div>
                  <div className="text-sm text-[#e8e3d5] font-medium">Transit observed</div>
                  <div className="text-xs text-[#e8e3d5]/40 mt-1">{observedTransitHours}h transit observed • SLA trigger: above {transitThresholdHours}h.</div>
                </div>
              </div>
            )}
            {isLogisticsPolicy && hasProviderCheck && policy.status === 'active' && !logisticsThresholdMet && (
              <div className="flex gap-4">
                <div className="w-2 h-2 mt-1.5 bg-amber-200 rounded-full"></div>
                <div>
                  <div className="text-sm text-[#e8e3d5] font-medium">Threshold not met</div>
                  <div className="text-xs text-[#e8e3d5]/40 mt-1">Transit time is still within the {transitThresholdHours}h SLA window.</div>
                </div>
              </div>
            )}
            {['triggered', 'paid'].includes(policy.status) && (
              <div className="flex gap-4">
                <div className="w-2 h-2 mt-1.5 bg-red-300 rounded-full"></div>
                <div>
                  <div className="text-sm text-[#e8e3d5] font-medium">Threshold breached</div>
                  <div className="text-xs text-[#e8e3d5]/40 mt-1">{formatDate(policy.triggeredAt)} • Monitoring observed the trigger condition and advanced the payout flow.</div>
                </div>
              </div>
            )}
            {policy.status === 'paid' && (
              <div className="flex gap-4">
                <div className="w-2 h-2 mt-1.5 bg-[#a9ddd3] rounded-full"></div>
                <div>
                  <div className="text-sm text-[#e8e3d5] font-medium">Payout credited</div>
                  <div className="text-xs text-[#e8e3d5]/40 mt-1">{formatDate(policy.paidAt)} • {policy.payout} USDC added to Arca balance.</div>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
