const requestBody = `{
  "partner_id": "traveldesk_demo",
  "user_id": "user_demo",
  "customer_email": "customer@example.com",
  "external_reference": "booking_124",
  "quote_request": {
    "category": "flight",
    "target": "BA112",
    "coverage_amount": 300,
    "condition_params": {
      "delay_minutes": 120
    }
  }
}`;

const responseBody = `{
  "partner_id": "traveldesk_demo",
  "external_reference": "booking_124",
  "quote": {
    "premium": 15.55,
    "payout": 300,
    "trigger": "> 120 Minutes Delay",
    "target": "BA112"
  },
  "policy": {
    "id": "policy_a5d20bbd58309bb1",
    "status": "active",
    "source": "FlightAware Global Flight API"
  }
}`;

const curlExample = `curl -s -X POST http://localhost:8000/partners/policies \\
  -H 'Content-Type: application/json' \\
  -d '${requestBody.replaceAll('\n', '')}'`;

const fields = [
  ['partner_id', 'Required partner identifier for revenue share and reporting.'],
  ['user_id', 'Arca user id to own the policy. Defaults to the demo user in local builds.'],
  ['customer_email', 'Optional customer receipt or support reference.'],
  ['external_reference', 'Optional booking, order, shipment, or checkout id from the partner app.'],
  ['quote_request', 'Same policy quote payload used by the consumer checkout flow.'],
];

export default function ApiDocs() {
  return (
    <div className="relative w-full min-h-screen flex flex-col pt-24 md:pt-32 pb-24 items-center bg-[#040507]">
      <main className="z-10 w-full max-w-5xl px-4 md:px-6 animate-fade-up">
        <header className="mb-8 md:mb-10">
          <div className="text-[10px] md:text-xs font-semibold tracking-widest uppercase text-yellow-200 mb-3">
            Internal Future Surface
          </div>
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-5">
            <div>
              <h1 className="text-3xl md:text-5xl font-bold text-[#e8e3d5] font-mono tracking-tight">
                Embedded Policy Creation
              </h1>
              <p className="mt-3 max-w-2xl text-sm md:text-base text-[#e8e3d5]/60 leading-relaxed">
                This partner checkout surface is kept for future B2B work. It is not part of the current consumer MVP.
              </p>
            </div>
            <div className="rounded-lg border border-[#a9ddd3]/25 bg-[#a9ddd3]/10 px-4 py-3 text-xs font-mono text-[#a9ddd3]">
              POST /partners/policies
            </div>
          </div>
        </header>

        <section className="grid lg:grid-cols-[1fr_1.1fr] gap-5 md:gap-6">
          <div className="space-y-5">
            <div className="bg-[#e8e3d5]/5 rounded-lg border border-[#e8e3d5]/10 p-5 md:p-6">
              <h2 className="text-sm font-semibold text-[#e8e3d5] mb-4">Request Fields</h2>
              <div className="space-y-4">
                {fields.map(([name, description]) => (
                  <div key={name} className="border-b border-white/5 last:border-b-0 pb-3 last:pb-0">
                    <div className="text-xs font-mono text-[#a9ddd3]">{name}</div>
                    <div className="mt-1 text-xs text-[#e8e3d5]/55 leading-relaxed">{description}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-[#e8e3d5]/5 rounded-lg border border-[#e8e3d5]/10 p-5 md:p-6">
              <h2 className="text-sm font-semibold text-[#e8e3d5] mb-4">Supported Categories</h2>
              <div className="grid grid-cols-3 gap-3">
                {['flight', 'weather', 'logistics'].map((category) => (
                  <div key={category} className="rounded-md border border-white/10 bg-[#040507]/50 px-3 py-3 text-center text-[10px] uppercase tracking-widest text-[#e8e3d5]/70">
                    {category}
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs text-[#e8e3d5]/50 leading-relaxed">
                Logistics policies use Arca&apos;s built-in SLA simulation rail in this prototype.
              </p>
            </div>
          </div>

          <div className="space-y-5">
            <div className="bg-[#e8e3d5]/5 rounded-lg border border-[#e8e3d5]/10 overflow-hidden">
              <div className="border-b border-white/10 px-5 py-3 text-[10px] font-bold tracking-widest uppercase text-[#e8e3d5]/50">
                Example Request
              </div>
              <pre className="overflow-x-auto p-5 text-xs leading-relaxed text-[#e8e3d5]/75"><code>{requestBody}</code></pre>
            </div>

            <div className="bg-[#e8e3d5]/5 rounded-lg border border-[#e8e3d5]/10 overflow-hidden">
              <div className="border-b border-white/10 px-5 py-3 text-[10px] font-bold tracking-widest uppercase text-[#e8e3d5]/50">
                Example Response
              </div>
              <pre className="overflow-x-auto p-5 text-xs leading-relaxed text-[#e8e3d5]/75"><code>{responseBody}</code></pre>
            </div>

            <div className="bg-[#040507]/70 rounded-lg border border-[#a9ddd3]/20 overflow-hidden">
              <div className="border-b border-[#a9ddd3]/15 px-5 py-3 text-[10px] font-bold tracking-widest uppercase text-[#a9ddd3]">
                Local Test
              </div>
              <pre className="overflow-x-auto p-5 text-xs leading-relaxed text-[#e8e3d5]/70"><code>{curlExample}</code></pre>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
