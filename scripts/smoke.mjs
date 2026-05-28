const API_URL = process.env.ARCA_SMOKE_API_URL || process.env.VITE_ARCA_API_URL || 'http://127.0.0.1:8000';
const USER_ID = process.env.ARCA_SMOKE_USER_ID || process.env.VITE_ARCA_DEMO_USER_ID || 'user_demo';
const SMOKE_TOKEN = process.env.ARCA_SMOKE_TOKEN;

const state = {
  quote: null,
  policy: null,
  settledPolicy: null,
  balance: null,
  withdrawal: null,
  withdrawals: [],
  ledger: [],
};

const log = (message) => {
  console.log(`smoke: ${message}`);
};

const fail = (message, details) => {
  console.error(`smoke failed: ${message}`);
  if (details) console.error(JSON.stringify(details, null, 2));
  process.exit(1);
};

const request = async (path, options = {}) => {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Arca-User-Id': USER_ID,
      ...(SMOKE_TOKEN ? { Authorization: `Bearer ${SMOKE_TOKEN}` } : {}),
      ...(options.headers || {}),
    },
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    fail(`${options.method || 'GET'} ${path} returned ${response.status}`, body);
  }

  return body;
};

const assert = (condition, message, details) => {
  if (!condition) fail(message, details);
};

const main = async () => {
  log(`using API ${API_URL}`);

  const health = await request('/health');
  assert(health.status === 'ok', 'API health check did not return ok', health);
  log('API health ok');

  const suffix = Date.now();
  state.quote = await request('/quotes', {
    method: 'POST',
    body: JSON.stringify({
      category: 'weather',
      target: `Smoke Farm ${suffix}`,
      coverage_amount: 10,
      condition_params: {
        rainfall_mm: 10,
      },
    }),
  });
  assert(state.quote?.premium > 0, 'quote did not include a premium', state.quote);
  assert(state.quote?.payout === 10, 'quote payout did not match requested coverage', state.quote);
  log(`quote created: ${state.quote.premium} USDC premium for ${state.quote.payout} USDC coverage`);

  state.policy = await request('/policies', {
    method: 'POST',
    body: JSON.stringify({
      user_id: USER_ID,
      quote: state.quote,
    }),
  });
  assert(state.policy?.id, 'policy was not created', state.policy);
  assert(state.policy.status === 'active', 'new policy is not active', state.policy);
  log(`policy active: ${state.policy.id}`);

  const triggered = await request(`/policies/${state.policy.id}/trigger`, {
    method: 'POST',
    body: JSON.stringify({
      source_payload: {
        provider: 'smoke-test',
        observed_rain_mm: 0,
        note: 'End-to-end smoke trigger',
      },
    }),
  });
  assert(triggered.status === 'triggered', 'policy did not move to triggered', triggered);
  log('policy triggered');

  state.settledPolicy = await request(`/policies/${state.policy.id}/settle`, { method: 'POST' });
  assert(state.settledPolicy.status === 'paid', 'policy did not settle to paid', state.settledPolicy);
  assert(state.settledPolicy.paid_at, 'settled policy is missing paid_at', state.settledPolicy);
  log('policy settled and payout credited');

  state.balance = await request(`/users/${USER_ID}/balance`);
  assert(state.balance.available_balance >= 0.01, 'available balance is too low for payout history smoke test', state.balance);
  log(`available balance: ${state.balance.available_balance} USDC`);

  state.withdrawal = await request('/withdrawals', {
    method: 'POST',
    body: JSON.stringify({
      user_id: USER_ID,
      amount: 0.01,
      destination_name: `Smoke Test Account ${suffix}`,
      destination_iban: 'SMOKE-LOCAL-ACCOUNT',
      destination_swift: 'ARCAUSDC',
      destination_wallet_address: null,
      destination_chain: 'BASE',
    }),
  });
  assert(state.withdrawal?.id, 'withdrawal was not created', state.withdrawal);
  assert(state.withdrawal.status === 'initiated', 'withdrawal was not initiated', state.withdrawal);
  log(`payout history record created: ${state.withdrawal.id}`);

  state.withdrawals = await request(`/users/${USER_ID}/withdrawals`);
  assert(
    state.withdrawals.some((item) => item.id === state.withdrawal.id),
    'created withdrawal was not present in payout history',
    state.withdrawals,
  );
  log('payout history includes new record');

  state.ledger = await request(`/users/${USER_ID}/ledger`);
  assert(
    state.ledger.some((item) => item.event_type === 'payout_paid' && item.metadata?.policy_id === state.policy.id),
    'ledger is missing policy payout event',
    state.ledger,
  );
  assert(
    state.ledger.some((item) => item.entity_id === state.withdrawal.id && item.event_type === 'withdrawal_initiated'),
    'ledger is missing withdrawal event',
    state.ledger,
  );
  log('ledger includes payout and withdrawal events');

  console.log(JSON.stringify({
    ok: true,
    policy_id: state.policy.id,
    withdrawal_id: state.withdrawal.id,
    available_balance: state.balance.available_balance,
  }, null, 2));
};

main().catch((error) => {
  fail(error.message || 'unexpected smoke test error');
});
