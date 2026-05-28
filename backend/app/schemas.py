from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field


PolicyCategory = Literal["flight", "weather", "logistics"]
PolicyStatus = Literal["active", "triggered", "paid", "expired", "cancelled"]


class UserCreate(BaseModel):
    email: EmailStr
    phone: str | None = None
    rialo_address: str | None = None


class UserOut(BaseModel):
    id: str
    email: str
    privy_user_id: str | None = None
    phone: str | None
    rialo_address: str | None
    kyc_status: str
    created_at: str


class QuoteRequest(BaseModel):
    category: PolicyCategory
    target: str = Field(min_length=2)
    coverage_amount: float = Field(gt=0)
    condition_params: dict[str, Any] = Field(default_factory=dict)


class QuoteOut(BaseModel):
    category: PolicyCategory
    premium: float
    payout: float
    trigger: str
    engine: str
    oracle: str
    source: str
    target: str
    condition_params: dict[str, Any]


class PolicyCreate(BaseModel):
    user_id: str
    quote: QuoteOut


class PartnerPolicyCreate(BaseModel):
    partner_id: str = Field(min_length=2)
    user_id: str = "user_demo"
    customer_email: EmailStr | None = None
    quote_request: QuoteRequest
    external_reference: str | None = None


class PolicyOut(BaseModel):
    id: str
    user_id: str
    category: str
    type: str
    status: PolicyStatus
    premium: float
    payout: float
    contract_address: str
    target: str
    trigger: str
    engine: str
    oracle: str
    source: str
    current_status: str
    condition_params: dict[str, Any]
    created_at: str
    triggered_at: str | None
    paid_at: str | None
    expired_at: str | None
    expires_at: str


class PartnerPolicyOut(BaseModel):
    partner_id: str
    external_reference: str | None = None
    quote: QuoteOut
    policy: PolicyOut


class TriggerRequest(BaseModel):
    delay_minutes: int | None = None
    observed_value: float | None = None
    source_payload: dict[str, Any] = Field(default_factory=dict)


class PayoutOut(BaseModel):
    id: str
    policy_id: str
    user_id: str
    amount: float
    trigger_data: dict[str, Any]
    tx_hash: str
    status: str
    paid_at: str


class WithdrawalCreate(BaseModel):
    user_id: str
    amount: float = Field(gt=0)
    destination_name: str = Field(min_length=2)
    destination_iban: str = Field(min_length=8)
    destination_swift: str = Field(min_length=6)
    destination_wallet_address: str | None = Field(default=None, pattern=r"^0x[a-fA-F0-9]{40}$")
    destination_chain: str = "BASE"
    idempotency_key: str | None = Field(default=None, min_length=8, max_length=120)


class WithdrawalOut(BaseModel):
    id: str
    user_id: str
    amount: float
    destination_name: str
    destination_iban: str
    destination_swift: str
    destination_wallet_address: str | None = None
    destination_chain: str = "BASE"
    rail: str = "bank"
    rail_status: str | None = None
    transfer_id: str | None = None
    tx_hash: str | None = None
    transfer_payload: dict[str, Any] | None = None
    idempotency_key: str | None = None
    status: str
    created_at: str


class LedgerEventOut(BaseModel):
    id: str
    user_id: str
    entity_type: str
    entity_id: str
    event_type: str
    amount: float
    metadata: dict[str, Any]
    created_at: str


class BalanceOut(BaseModel):
    user_id: str
    available_balance: float
    paid_payouts: float
    initiated_withdrawals: float


class ReserveStatusOut(BaseModel):
    reserve_balance: float
    initial_reserve: float
    premium_income: float
    paid_payouts: float
    active_liabilities: float
    available_capacity: float
    reserve_ratio: float | None


class CircleTransferAttemptOut(BaseModel):
    id: str
    withdrawal_id: str
    idempotency_key: str
    status: str
    request_payload: dict[str, Any]
    response_payload: dict[str, Any] | None = None
    error: str | None = None
    attempt_count: int = 1
    next_attempt_at: str | None = None
    last_attempt_at: str | None = None
    locked_at: str | None = None
    review_reason: str | None = None
    operator_notes: str | None = None
    created_at: str
    updated_at: str


class CircleRetryOut(BaseModel):
    retried: int
    needs_review: int = 0
    attempts: list[CircleTransferAttemptOut]


class CircleAttemptReviewUpdate(BaseModel):
    status: str | None = Field(default=None, pattern=r"^(needs_review|failed|initiated)$")
    review_reason: str | None = Field(default=None, max_length=500)
    operator_notes: str | None = Field(default=None, max_length=1000)
