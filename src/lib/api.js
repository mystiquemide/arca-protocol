import { getLedgerActivity, getPolicies, getPolicyBalance } from './policies';

export const API_URL = import.meta.env.VITE_ARCA_API_URL || 'http://localhost:8000';
export const DEMO_USER_ID = import.meta.env.VITE_ARCA_DEMO_USER_ID || 'user_demo';

let accessTokenGetter = null;
let activeUserId = DEMO_USER_ID;

export const configureArcaAuth = ({ getAccessToken, userId } = {}) => {
  accessTokenGetter = typeof getAccessToken === 'function' ? getAccessToken : null;
  activeUserId = userId || DEMO_USER_ID;
};

export const getActiveUserId = () => activeUserId || DEMO_USER_ID;

const authHeaders = async () => {
  const headers = {};
  if (activeUserId) {
    headers['X-Arca-User-Id'] = activeUserId;
  }

  if (!accessTokenGetter) return headers;

  const token = await accessTokenGetter().catch(() => null);
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
};

const request = async (path, options = {}) => {
  const dynamicHeaders = await authHeaders();
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...dynamicHeaders,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `API request failed: ${response.status}`);
  }

  return response.json();
};

export const toBackendQuoteRequest = ({ category, flightNo, farmLocation, rainfall, trackingId, maxTransit }) => {
  if (category === 'weather') {
    return {
      category,
      target: farmLocation,
      coverage_amount: 2500,
      condition_params: { rainfall_mm: Number(rainfall || 10) },
    };
  }

  if (category === 'logistics') {
    return {
      category,
      target: trackingId,
      coverage_amount: 500,
      condition_params: { max_transit_hours: Number(maxTransit || 48) },
    };
  }

  return {
    category,
    target: flightNo,
    coverage_amount: 300,
    condition_params: { delay_minutes: 120 },
  };
};

export const normalizePolicy = (policy) => ({
  id: policy.id,
  category: policy.category,
  type: policy.type,
  badge: policy.category === 'flight' ? 'Aviation' : policy.category === 'weather' ? 'Weather' : 'Logistics',
  status: policy.status,
  premium: Number(policy.premium).toFixed(2),
  payout: Number(policy.payout).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  contractAddress: policy.contract_address,
  target: policy.target,
  trigger: policy.trigger,
  engine: policy.engine,
  oracle: policy.oracle,
  source: policy.source,
  currentStatus: policy.current_status,
  conditionParams: policy.condition_params,
  createdAt: policy.created_at,
  triggeredAt: policy.triggered_at,
  paidAt: policy.paid_at,
  expiredAt: policy.expired_at,
  expiresAt: policy.expires_at,
  backend: true,
});

export const normalizeLedgerEvent = (event) => {
  const isPositive = event.amount > 0;
  const isWarning = event.event_type === 'trigger_met';
  const metadata = event.metadata || {};

  return {
    id: event.id,
    policyId: event.entity_type === 'policy' ? event.entity_id : metadata.policy_id || null,
    type: event.entity_type === 'withdrawal' ? 'withdrawal' : event.event_type === 'trigger_met' ? 'triggered' : isPositive ? 'payout' : 'premium',
    title:
      event.event_type === 'withdrawal_initiated'
        ? `Withdrawal to ${metadata.destination || 'External Account'}`
        : event.event_type === 'trigger_met'
          ? `${metadata.target || 'Policy'} Trigger Met`
          : event.event_type === 'payout_paid'
            ? `${metadata.target || 'Policy'} Policy Payout`
            : `${metadata.target || 'Policy'} Premium Collected`,
    detail:
      event.event_type === 'withdrawal_initiated'
        ? 'External transfer initiated'
        : event.event_type === 'trigger_met'
          ? 'Resolution condition observed'
          : event.event_type === 'payout_paid'
            ? 'Parametric trigger settled'
            : 'Premium locked',
    amount: `${isPositive ? '+ ' : '- '}${Math.abs(Number(event.amount)).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    tone: isPositive ? 'positive' : isWarning ? 'warning' : 'muted',
    date: event.created_at,
  };
};

export const arcaApi = {
  health: () => request('/health'),
  getAuthMe: () => request('/auth/me'),
  createUser: (payload) => request('/users', { method: 'POST', body: JSON.stringify(payload) }),
  getProviderStatus: () => request('/providers/status'),
  createQuote: (payload) => request('/quotes', { method: 'POST', body: JSON.stringify(payload) }),
  createPolicy: (quote, userId = getActiveUserId()) => request('/policies', { method: 'POST', body: JSON.stringify({ user_id: userId, quote }) }),
  syncPolicies: (userId = getActiveUserId()) => request(`/users/${userId}/policies/sync`, { method: 'POST' }),
  listPolicies: async (userId = getActiveUserId()) => {
    const policies = await request(`/users/${userId}/policies`);
    return policies.map(normalizePolicy);
  },
  getPolicy: async (policyId) => normalizePolicy(await request(`/policies/${policyId}`)),
  simulateFlightDelay: async (policyId, delayMinutes = 180) => normalizePolicy(await request(`/dev/policies/${policyId}/simulate-flight-delay?delay_minutes=${delayMinutes}`, {
    method: 'POST',
  })),
  simulateWeatherRainfall: async (policyId, rainfallMm = 0) => normalizePolicy(await request(`/dev/policies/${policyId}/simulate-weather-rainfall?rainfall_mm=${rainfallMm}`, {
    method: 'POST',
  })),
  simulateLogisticsDelay: async (policyId, transitHours = 72) => normalizePolicy(await request(`/dev/policies/${policyId}/simulate-logistics-delay?transit_hours=${transitHours}`, {
    method: 'POST',
  })),
  triggerPolicy: async (policyId) => normalizePolicy(await request(`/policies/${policyId}/trigger`, {
    method: 'POST',
    body: JSON.stringify({ source_payload: { provider: 'admin-panel' } }),
  })),
  settlePolicy: (policyId) => request(`/policies/${policyId}/settle`, { method: 'POST' }),
  getBalance: (userId = getActiveUserId()) => request(`/users/${userId}/balance`),
  createWithdrawal: (payload) => request('/withdrawals', { method: 'POST', body: JSON.stringify(payload) }),
  syncWithdrawals: (userId = getActiveUserId()) => request(`/users/${userId}/withdrawals/sync`, { method: 'POST' }),
  listWithdrawals: (userId = getActiveUserId()) => request(`/users/${userId}/withdrawals`),
  cleanupFailedWithdrawals: (userId = getActiveUserId()) => request(`/dev/users/${userId}/withdrawals/cleanup-failed`, { method: 'POST' }),
  resetDemoData: () => request('/dev/reset', { method: 'POST' }),
  getLedger: async (userId = getActiveUserId()) => {
    const events = await request(`/users/${userId}/ledger`);
    return events.map(normalizeLedgerEvent);
  },
};

export const getLocalDashboardData = () => {
  const policies = getPolicies();
  return {
    policies,
    balance: getPolicyBalance(policies),
    activity: getLedgerActivity(policies),
  };
};
