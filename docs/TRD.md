ARCA
Technical Requirements Document
Version 1.0  |  Confidential  |  May 2026
Field	Details
Document Type	Technical Requirements Document (TRD)
Product	Arca
Chain	Rialo (Testnet -> Mainnet)
Smart Contract Language	RISC-V / SVM compatible (Rialo REX Runtime)
Frontend Stack	Next.js 14, TypeScript, Tailwind CSS
Backend Stack	FastAPI (Python), Supabase
Version	1.0
Author	Mide (@MystiqueMide)

1. System Architecture Overview
Arca is composed of four distinct layers that together create a fully autonomous parametric insurance protocol. The key design principle is that the blockchain layer is completely invisible to end users, who interact only with a Web2-style interface.
1.1 Architecture Layers
Layer	Technology	Responsibility
Presentation	Next.js 14, Tailwind	User-facing interface, policy purchase flow, dashboard
Application	FastAPI, Python	API gateway, fiat on/off ramp, premium calculation, user management
Data	Supabase (PostgreSQL)	User profiles, policy records, transaction history, audit logs
Protocol	Rialo Smart Contracts	Policy lifecycle, reserve management, autonomous payout execution

2. Smart Contract Architecture
2.1 Contract Overview
Arca deploys three core contracts on Rialo, leveraging the REX (Rialo Extended Execution Runtime) for reactive transaction support.
PolicyFactory.rialo
Responsible for deploying individual policy contracts. Accepts policy parameters, validates inputs, calculates reserve requirements, and deploys a new PolicyContract instance per policy.
•	Inputs: user address, policy type, coverage amount, condition parameters, expiry
•	Outputs: deployed PolicyContract address, policy ID
•	Access: callable by any authenticated user via the application backend
PolicyContract.rialo
The core autonomous policy contract. Contains the reactive transaction logic that watches external data and triggers payouts. Each policy is its own contract instance.
•	State: ACTIVE, TRIGGERED, PAID, EXPIRED, CANCELLED
•	Reactive transaction: sleeps until data condition is met or policy expires
•	Native HTTP call: pings designated data API at configurable intervals
•	Payout: transfers coverage amount from reserve to user address on trigger
•	Expiry: returns premium to reserve pool if policy expires without trigger
ReservePool.rialo
Manages the protocol reserve. Holds all premium capital, distributes payouts when policies trigger, and deploys idle capital to yield strategies.
•	Tracks total reserve, allocated capital per policy, and unallocated float
•	Integrates with Rialo DeFi protocols for yield on unallocated float
•	Enforces solvency checks: new policies only deploy if reserve ratio is maintained
•	Emits events for all capital movements for full auditability
2.2 Reactive Transaction Flow
The following describes the lifecycle of a PolicyContract reactive transaction on Rialo:
1. Policy deployed with encoded conditions (e.g. flight: AA123, delay: >120min)
2. Reactive transaction registered with Rialo validator network
3. Contract enters SLEEPING state - consumes no gas until conditions checked
4. At configurable interval, Rialo validator pings designated API endpoint
5. Response parsed against condition predicate stored in contract state
6. If condition NOT met: contract returns to sleep, schedules next check
7. If condition MET: reactive transaction fires, state -> TRIGGERED
8. Payout transfer executes atomically in same block as trigger
9. ReservePool updated, user balance credited, event emitted
10. Contract state -> PAID, reactive transaction deregistered
2.3 Data Source Integration
Product Line	Primary Data Source	Fallback / Cross-reference
Flight Delay	FlightAware AeroAPI	OAG Flight Status, Cirium
Weather Parametric	OpenWeatherMap API	NOAA, local national met services
Logistics / Cargo	Project44 / FourKites API	Shipsgo, carrier-native tracking APIs

3. Backend Architecture
3.1 FastAPI Service
The FastAPI backend serves as the application layer between the frontend and the Rialo protocol. It handles all user-facing operations that do not require direct smart contract interaction.
Core Endpoints
POST   /api/v1/auth/register          # Email/phone registration
POST   /api/v1/auth/login             # Session creation
GET    /api/v1/policy/quote           # Real-time premium calculation
POST   /api/v1/policy/create          # Policy purchase + contract deployment
GET    /api/v1/policy/{id}            # Policy status and details
GET    /api/v1/policy/user/{uid}      # All policies for a user
POST   /api/v1/payout/withdraw        # Initiate fiat withdrawal
GET    /api/v1/reserve/status         # Protocol reserve health
Premium Calculation Engine
Premium pricing is computed dynamically at quote time using actuarial inputs. The calculation engine pulls live data to assess current risk before pricing each policy.
•	Flight delay: historical delay rate for specific route + airline, time of year, weather forecast
•	Weather: historical frequency of threshold breach for location + season
•	Logistics: carrier SLA history, route congestion data, seasonal factors
•	Base premium = (probability of trigger) x (coverage amount) x (1 + protocol fee %)
3.2 Supabase Schema
Core Tables
users           - id, email, phone, rialo_address, kyc_status, created_at
policies        - id, user_id, type, status, coverage_amount, premium,
                  contract_address, condition_params, expires_at, created_at
payouts         - id, policy_id, user_id, amount, trigger_data,
                  tx_hash, status, paid_at
withdrawals     - id, user_id, amount, destination, status, created_at
reserve_events  - id, event_type, amount, tx_hash, created_at
audit_log       - id, entity_type, entity_id, action, metadata, created_at

4. Frontend Architecture
4.1 Stack
•	Next.js 14 with App Router
•	TypeScript throughout
•	Tailwind CSS for styling
•	Rialo SDK for wallet abstraction and contract interaction
•	Stripe.js for fiat payment collection
•	Deployed on Vercel
4.2 Core Pages and Routes
/                     # Landing page - product hero, how it works
/insurance/flight     # Flight delay policy purchase flow
/insurance/weather    # Weather parametric policy purchase flow
/insurance/logistics  # Cargo and logistics policy purchase flow
/dashboard            # User portfolio, active policies, payout history
/policy/[id]          # Individual policy detail and live monitoring status
/withdraw             # Payout withdrawal management
/api-docs             # B2B partner API documentation
4.3 Key Frontend Components
•	PolicyWizard - multi-step purchase flow, 3 screens max per product line
•	QuoteCard - real-time premium display, updates on input change
•	MonitoringStatus - live policy status with data feed indicator
•	PayoutNotification - push notification + in-app alert on payout trigger
•	ReserveHealthBar - protocol reserve ratio displayed for transparency

5. Identity and Payment Infrastructure
5.1 User Identity
Arca uses Rialo's native email and phone login system. Users never see a wallet address or manage private keys. Their Rialo account is created automatically on registration and linked to their email or phone number.
•	Registration: email or phone number, password, optional 2FA
•	KYC: lightweight identity verification for payouts above $500 threshold
•	KYC provider: Persona or Sumsub (API integration)
•	Rialo wallet address generated and stored server-side, abstracted from user
5.2 Fiat On-Ramp (Premium Payment)
•	Primary: Stripe (card, Apple Pay, Google Pay)
•	Backend converts fiat to USDC via Stripe on-ramp or Circle API
•	USDC deposited into ReservePool on behalf of user
•	Policy contract funded from reserve allocation
5.3 Fiat Off-Ramp (Payout Withdrawal)
•	Payout lands in user's email-linked Rialo balance in USDC
•	User initiates withdrawal to bank account or card
•	Off-ramp provider: Transak or MoonPay for global coverage
•	Local bank transfer integrations added per market as volume grows

6. Security Requirements
6.1 Smart Contract Security
•	All contracts audited before mainnet deployment
•	ReservePool uses multi-sig governance for parameter changes
•	Policy caps enforced on-chain: max coverage per policy, max allocation per reserve
•	Emergency pause function on ReservePool accessible by multi-sig
•	All contract upgrades require timelock + governance vote
6.2 Application Security
•	All API endpoints authenticated via JWT with short expiry
•	Rate limiting on quote and policy creation endpoints
•	Input validation on all policy condition parameters before contract deployment
•	Withdrawal requests require email or 2FA confirmation
•	All fiat transactions logged and reconciled daily against Supabase records
6.3 Data Security
•	No private keys stored in application layer
•	KYC data encrypted at rest in Supabase
•	All API keys for data providers stored in environment variables, never in code
•	Audit log is append-only, no delete operations permitted

7. Deployment and Infrastructure
Component	Infrastructure
Frontend	Vercel (auto-deploy from GitHub main branch)
Backend API	Railway (FastAPI container, auto-scale)
Database	Supabase (managed PostgreSQL, row-level security)
Smart Contracts	Rialo Testnet -> Rialo Mainnet
Monitoring	Sentry (errors), Datadog (API health), Rialo Explorer (contract events)
CI/CD	GitHub Actions (lint, test, deploy on merge to main)
Secrets Management	Railway environment variables, Vercel env

8. Build Phases
Phase 1 - Core Protocol (Weeks 1-6)
•	PolicyFactory, PolicyContract, ReservePool contracts written and unit tested
•	Flight delay reactive transaction implemented and tested on Rialo testnet
•	FlightAware API integrated as native HTTP call from contract
•	FastAPI backend with auth, quote, policy creation, and payout endpoints
•	Supabase schema deployed with RLS policies
Phase 2 - Frontend and Fiat (Weeks 7-10)
•	Next.js frontend with flight delay purchase flow
•	Stripe integration for premium payment
•	Transak integration for payout withdrawal
•	User dashboard with active policy monitoring
•	End-to-end testnet flow with real flight data
Phase 3 - Expand and Harden (Weeks 11-14)
•	Weather parametric product added
•	Smart contract audit commissioned
•	KYC integration for high-value payouts
•	B2B API documentation and sandbox environment
•	Mainnet deployment preparation and reserve seeding

Arca - TRD v1.0 - Confidential

