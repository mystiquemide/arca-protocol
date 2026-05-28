# Frontend Polish Handoff

## Goal
Give the next frontend engineer a clean product-state map so they can polish the UX without accidentally presenting demo rails as fully live infrastructure.

## Current Product Truth

### 1. Provider-backed demo
These flows use real backend APIs or real provider data, but the product should still be presented as a monitored demo rather than a fully live onchain insurance protocol.

* **Authentication:** Privy login is real.
* **Database:** Neon/Postgres-backed backend path is real.
* **Aviation monitoring:** FlightAware-backed when configured.
* **Weather monitoring:** Open-Meteo-backed when reachable.
* **Circle payout operations:** backend integration, audit trail, retry controls, receipts, and history are real enough for internal testing.

Recommended language:
* `provider-backed`
* `monitoring feed`
* `internal testing`
* `demo rail`

Avoid language like:
* `mainnet`
* `fully live`
* `autonomous onchain settlement`
* `deployed on Rialo`

## 2. Simulated
These should be clearly marked as simulated in the interface.

* **Logistics monitoring**
  * Keep it framed as `simulated carrier feed` or `demo SLA monitoring`.
* **Policy deployment rail**
  * Until Rialo is actually usable on testnet/mainnet, policy creation should read as a policy record or demo rail action, not a real chain deployment.
* **Trigger/resolution presentation**
  * The product can say Arca monitoring detected the condition and advanced the payout flow.
  * It should not imply a trustless live onchain resolver unless that is truly wired.

## 3. Internal testing only
These are functional but should not be framed as ready for broad consumer use.

* **Circle payouts**
  * Good for controlled low-value internal testing.
  * UI should avoid “everyone can use this safely in production” language.
* **Built-in Arca payout account**
  * Treat as `internal testing` unless the full consumer wallet/account experience is complete.

Recommended language:
* `broadcast enabled`
* `staged`
* `internal testing`
* `coming soon`

## 4. Coming soon
These should stay softened or hidden until the real product path exists.

* **Arca account as a polished consumer payout destination**
* **Real Rialo contract deployment**
* **Real logistics provider**
* **Any “future/internal” controls that do not help a demo user**

## UI Polish Priorities

### Highest priority
* Tighten empty states.
* Tighten error states.
* Remove or soften copy that sounds more production-live than reality.
* Keep the product feeling premium even when it says `simulated`, `internal testing`, or `coming soon`.

### Good follow-up work
* Make history and payout statuses easier to scan.
* Add small explainer copy only where users could misread a state.
* Keep admin/demo language out of consumer surfaces where possible.
* Ensure receipts feel polished and trustworthy.

## Screens To Review
* `/quote`
* `/dashboard`
* `/policy/:id`
* `/settings`
* payout surfaces
* transfer history

## What Not To Rework
* Do not redesign backend contracts or API behavior in the polish pass.
* Do not re-open auth, payout retry, or deployment architecture unless a real bug is found.
* Do not force a fake “live Rialo” story.

## Simple Positioning
Use this mental model during polish:

* **Aviation and weather:** provider-backed monitored demo
* **Logistics:** simulated demo rail
* **Circle payouts:** internal testing rail
* **Arca account destination:** coming soon / partial
* **Rialo deployment:** deferred until real chain path exists
