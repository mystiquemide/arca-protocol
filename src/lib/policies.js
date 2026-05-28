const POLICIES_KEY = 'arca_policies';
const PAYOUT_COMPLETE_KEY = 'simulated_payout_complete';
const WITHDRAWAL_KEY = 'arca_withdrawal';
const WITHDRAWALS_KEY = 'arca_withdrawals';

const categoryMeta = {
  flight: {
    type: 'Aviation Delay',
    badge: 'Aviation',
    source: 'FlightAware API',
    defaultStatus: 'On Time (0m Delay)',
  },
  weather: {
    type: 'Weather Parametric',
    badge: 'Weather',
    source: 'Open-Meteo / NOAA',
    defaultStatus: 'Monitoring Rainfall',
  },
  logistics: {
    type: 'Logistics SLA',
    badge: 'Logistics',
    source: 'Arca SLA Simulation',
    defaultStatus: 'In Transit',
  },
};

export const seedPolicies = [
  {
    id: 'policy_ba112',
    category: 'flight',
    type: 'Aviation Delay',
    badge: 'Aviation',
    status: 'active',
    premium: '14.50',
    payout: '300.00',
    contractAddress: '0x8F2aB7e19C4A03d87D439C',
    target: 'BA-112',
    trigger: '> 120 Minutes Delay',
    engine: 'Aviation Risk Model (Flight: BA-112)',
    oracle: 'Simulated FlightAware Node',
    source: 'FlightAware API',
    currentStatus: 'On Time (0m Delay)',
    createdAt: '2026-05-23T09:00:00.000Z',
    expiresAt: '2026-05-24T23:59:59.000Z',
  },
  {
    id: 'policy_dl404',
    category: 'logistics',
    type: 'Logistics SLA',
    badge: 'Logistics',
    status: 'paid',
    premium: '8.50',
    payout: '400.00',
    contractAddress: '0x2B9c44dA0E7F5b2014F',
    target: 'DL-404',
    trigger: '> 48 Hours Transit',
    engine: 'Logistics Risk Model (AWB: DL-404)',
    oracle: 'Simulated FedEx/Maersk Oracle',
    source: 'Arca SLA Simulation',
    currentStatus: 'Payout Executed',
    createdAt: '2026-05-12T08:00:00.000Z',
    triggeredAt: '2026-05-14T15:20:00.000Z',
    paidAt: '2026-05-14T15:21:00.000Z',
    expiresAt: '2026-05-15T08:00:00.000Z',
  },
  {
    id: 'policy_af10',
    category: 'flight',
    type: 'Aviation Delay',
    badge: 'Aviation',
    status: 'expired',
    premium: '12.00',
    payout: '250.00',
    contractAddress: '0xAF10B43e92fD8810D3d',
    target: 'AF-10',
    trigger: '> 120 Minutes Delay',
    engine: 'Aviation Risk Model (Flight: AF-10)',
    oracle: 'Simulated FlightAware Node',
    source: 'FlightAware API',
    currentStatus: 'Safe Arrival',
    createdAt: '2026-04-03T07:30:00.000Z',
    expiredAt: '2026-04-03T23:59:59.000Z',
    expiresAt: '2026-04-03T23:59:59.000Z',
  },
];

const readJson = (key, fallback) => {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

export const parseUsdc = (amount) => Number(String(amount || '0').replaceAll(',', ''));

export const formatUsdc = (amount) => {
  return Number(amount || 0).toLocaleString('en', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

export const getPolicies = () => {
  const stored = readJson(POLICIES_KEY, null);
  if (Array.isArray(stored) && stored.length > 0) {
    const storedIds = new Set(stored.map((policy) => policy.id));
    const missingSeedPolicies = seedPolicies.filter((policy) => !storedIds.has(policy.id));
    const policies = [...stored, ...missingSeedPolicies];
    savePolicies(policies);
    return policies;
  }

  return seedPolicies;
};

export const savePolicies = (policies) => {
  localStorage.setItem(POLICIES_KEY, JSON.stringify(policies));
};

export const createPolicy = ({ category, quote, inputs }) => {
  const meta = categoryMeta[category] || categoryMeta.flight;
  const createdAt = new Date();
  const target =
    category === 'weather'
      ? inputs.farmLocation
      : category === 'logistics'
        ? inputs.trackingId
        : inputs.flightNo;

  const policy = {
    id: `policy_${createdAt.getTime()}`,
    category,
    type: meta.type,
    badge: meta.badge,
    status: 'active',
    premium: quote.premium,
    payout: quote.payout,
    contractAddress: `0x${Math.random().toString(16).slice(2, 8)}${Math.random().toString(16).slice(2, 14)}`,
    target,
    trigger: quote.trigger,
    engine: quote.engine,
    oracle: quote.oracle,
    source: meta.source,
    currentStatus: meta.defaultStatus,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + 1000 * 60 * 60 * 36).toISOString(),
  };

  const policies = getPolicies();
  savePolicies([policy, ...policies]);
  return policy;
};

export const triggerPolicyPayout = (policyId) => {
  const policies = getPolicies();
  const nextPolicies = policies.map((policy) => {
    if (policy.id !== policyId) return policy;

    return {
      ...policy,
      status: 'triggered',
      currentStatus: 'Threshold Breached',
      triggeredAt: new Date().toISOString(),
    };
  });

  savePolicies(nextPolicies);
  return nextPolicies.find((policy) => policy.id === policyId);
};

export const completePolicyPayout = (policyId) => {
  const policies = getPolicies();
  const nextPolicies = policies.map((policy) => {
    if (policy.id !== policyId) return policy;

    return {
      ...policy,
      status: 'paid',
      currentStatus: 'Payout Executed',
      paidAt: new Date().toISOString(),
    };
  });

  savePolicies(nextPolicies);
  localStorage.setItem(PAYOUT_COMPLETE_KEY, 'true');
  return nextPolicies.find((policy) => policy.id === policyId);
};

export const getWithdrawals = () => {
  const withdrawals = readJson(WITHDRAWALS_KEY, null);
  if (Array.isArray(withdrawals)) return withdrawals;

  const legacyWithdrawal = readJson(WITHDRAWAL_KEY, null);
  return legacyWithdrawal ? [legacyWithdrawal] : [];
};

export const getWithdrawal = () => getWithdrawals()[0] || null;

export const saveWithdrawal = (withdrawal) => {
  const withdrawals = getWithdrawals();
  localStorage.setItem(WITHDRAWALS_KEY, JSON.stringify([withdrawal, ...withdrawals]));
  localStorage.setItem(WITHDRAWAL_KEY, JSON.stringify(withdrawal));
};

export const clearWithdrawal = () => {
  localStorage.removeItem(WITHDRAWAL_KEY);
  localStorage.removeItem(WITHDRAWALS_KEY);
};

export const getPolicyBalance = (policies = getPolicies()) => {
  const payoutBalance = policies
    .filter((policy) => policy.status === 'paid')
    .reduce((sum, policy) => sum + parseUsdc(policy.payout), 0);
  const withdrawnAmount = getWithdrawals()
    .filter((withdrawal) => withdrawal.status === 'initiated')
    .reduce((sum, withdrawal) => sum + parseUsdc(withdrawal.amount), 0);

  return Math.max(payoutBalance - withdrawnAmount, 0);
};

export const getTriggeredPolicy = () => {
  const policyId = localStorage.getItem('simulated_payout');
  if (!policyId) return null;

  return getPolicies().find((policy) => policy.id === policyId || policy.target === policyId) || null;
};

export const getPolicyActivity = (policies = getPolicies()) => {
  const activity = policies.flatMap((policy) => {
    const items = [
      {
        id: `${policy.id}_created`,
        policyId: policy.id,
        type: 'premium',
        title: `${policy.target} Policy Created`,
        detail: `${policy.type} • Premium locked`,
        amount: `- ${policy.premium}`,
        tone: 'muted',
        date: policy.createdAt,
      },
    ];

    if (policy.status === 'active') {
      items.push({
        id: `${policy.id}_monitoring`,
        policyId: policy.id,
        type: 'monitoring',
        title: `${policy.target} Monitoring Active`,
        detail: `${policy.trigger} • ${policy.source}`,
        amount: policy.payout,
        tone: 'neutral',
        date: policy.createdAt,
      });
    }

    if (policy.triggeredAt) {
      items.push({
        id: `${policy.id}_triggered`,
        policyId: policy.id,
        type: 'triggered',
        title: `${policy.target} Trigger Met`,
        detail: `${policy.trigger} • Resolution pending`,
        amount: policy.payout,
        tone: 'warning',
        date: policy.triggeredAt,
      });
    }

    if (policy.paidAt) {
      items.push({
        id: `${policy.id}_paid`,
        policyId: policy.id,
        type: 'payout',
        title: `${policy.target} Policy Payout`,
        detail: 'Parametric trigger settled',
        amount: `+ ${policy.payout}`,
        tone: 'positive',
        date: policy.paidAt,
      });
    }

    if (policy.status === 'expired') {
      items.push({
        id: `${policy.id}_expired`,
        policyId: policy.id,
        type: 'expired',
        title: `${policy.target} Policy Expired`,
        detail: `${policy.currentStatus} • No trigger detected`,
        amount: `- ${policy.premium}`,
        tone: 'muted',
        date: policy.expiredAt || policy.expiresAt,
      });
    }

    return items;
  });

  return activity.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
};

export const getWithdrawalActivity = () => {
  return getWithdrawals().map((withdrawal) => ({
    id: `${withdrawal.id}_withdrawal`,
    policyId: null,
    type: 'withdrawal',
    title: `Withdrawal to ${withdrawal.destination}`,
    detail: withdrawal.status === 'initiated' ? 'External transfer initiated' : 'External transfer pending',
    amount: `- ${withdrawal.amount}`,
    tone: 'muted',
    date: withdrawal.createdAt,
  }));
};

export const getLedgerActivity = (policies = getPolicies()) => {
  return [...getPolicyActivity(policies), ...getWithdrawalActivity()].sort(
    (a, b) => new Date(b.date || 0) - new Date(a.date || 0),
  );
};

export const formatAddress = (address) => {
  if (!address) return '0x...';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

export const formatDate = (isoDate) => {
  if (!isoDate) return 'Pending';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: '2-digit',
  }).format(new Date(isoDate));
};
