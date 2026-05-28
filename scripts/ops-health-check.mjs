const API_URL = process.env.ARCA_OPS_API_URL || process.env.VITE_ARCA_API_URL || 'http://127.0.0.1:8000';
const ADMIN_TOKEN = process.env.ARCA_OPS_ADMIN_TOKEN || process.env.ARCA_ADMIN_API_TOKEN;
const FAIL_ON_WARNINGS = ['1', 'true', 'yes'].includes((process.env.ARCA_OPS_FAIL_ON_WARNINGS || '').toLowerCase());

const results = [];

const add = (name, status, message, details = undefined) => {
  results.push({ name, status, message, details });
};

const request = async (path, options = {}) => {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => null);
  return { response, body };
};

const checkReady = async () => {
  try {
    const { response, body } = await request('/ready');
    if (response.ok && body?.status === 'ready') {
      add('ready', 'ok', 'API is ready', body);
      return;
    }
    add('ready', 'fail', `Ready check returned ${response.status}`, body);
  } catch (error) {
    add('ready', 'fail', `Ready check failed: ${error.message}`);
  }
};

const checkProviders = async () => {
  try {
    const { response, body } = await request('/providers/status');
    if (!response.ok || !body) {
      add('providers', 'warn', `Provider status returned ${response.status}`, body);
      return;
    }

    const failed = Object.entries(body)
      .filter(([, provider]) => provider && provider.ok === false)
      .map(([name, provider]) => `${name}: ${provider.next_step || provider.error || 'not ok'}`);

    if (failed.length) {
      add('providers', 'warn', `Provider warnings: ${failed.join('; ')}`, body);
      return;
    }
    add('providers', 'ok', 'Providers report ok', body);
  } catch (error) {
    add('providers', 'warn', `Provider check failed: ${error.message}`);
  }
};

const checkCircleAttempts = async () => {
  if (!ADMIN_TOKEN) {
    add('circle_attempts', 'warn', 'Skipped Circle attempt check because no admin token was provided');
    return;
  }

  try {
    const { response, body } = await request('/admin/circle-transfer-attempts?limit=50', {
      headers: { 'X-Arca-Admin-Token': ADMIN_TOKEN },
    });
    if (!response.ok || !Array.isArray(body)) {
      add('circle_attempts', 'warn', `Circle attempts returned ${response.status}`, body);
      return;
    }

    const failed = body.filter((attempt) => ['failed', 'needs_review'].includes(attempt.status));
    if (failed.length) {
      add('circle_attempts', 'fail', `${failed.length} Circle attempt(s) need operator attention`, {
        ids: failed.map((attempt) => ({
          id: attempt.id,
          status: attempt.status,
          withdrawal_id: attempt.withdrawal_id,
          review_reason: attempt.review_reason,
          error: attempt.error,
        })),
      });
      return;
    }
    add('circle_attempts', 'ok', 'No failed or review-needed Circle attempts in latest 50');
  } catch (error) {
    add('circle_attempts', 'warn', `Circle attempt check failed: ${error.message}`);
  }
};

const main = async () => {
  console.log(`ops-health: checking ${API_URL}`);
  await checkReady();
  await checkProviders();
  await checkCircleAttempts();

  for (const result of results) {
    const prefix = result.status.toUpperCase();
    console.log(`${prefix}: ${result.name} - ${result.message}`);
  }

  console.log(JSON.stringify({ ok: !results.some((result) => result.status === 'fail'), results }, null, 2));

  const hasFailure = results.some((result) => result.status === 'fail');
  const hasWarning = results.some((result) => result.status === 'warn');
  if (hasFailure || (FAIL_ON_WARNINGS && hasWarning)) {
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(`ops-health failed: ${error.message}`);
  process.exit(1);
});
