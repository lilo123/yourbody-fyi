import React from 'react';
import { LegalLayout } from './LegalLayout';
import { HelpCircle, CheckCircle, Globe, RefreshCcw } from 'lucide-react';

export const RefundsPage: React.FC = () => {
  return (
    <LegalLayout
      title="Refund Policy"
      description="We believe refund policies should be fair, transparent, and respectful. If you are ever unhappy with Yourbody or experience an accidental charge, we want to help."
    >
      {/* 1. Fair Refund Philosophy */}
      <section aria-labelledby="philosophy-heading" className="space-y-3">
        <h2 id="philosophy-heading" className="text-lg font-bold text-white tracking-wide">
          1. Our Refund Philosophy
        </h2>
        <p>
          Unreasonable refund policies are frustrating. We never want you to feel trapped by a subscription. If you are unhappy with our Service or encounter billing issues, reach out to our team at{' '}
          <a
            href="mailto:support@yourbody.fyi"
            className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 font-semibold"
          >
            support@yourbody.fyi
          </a>{' '}
          and we will work with you to make it right.
        </p>
      </section>

      {/* 2. Yearly Subscriptions and 30-Day Window */}
      {/* MAINTAINER NOTE: 30-day refund window is a maintainer decision. Adjust duration if required. */}
      <section aria-labelledby="yearly-plans-heading" className="bg-zinc-950/60 border border-zinc-800/80 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2 text-cyan-300">
          <RefreshCcw className="w-5 h-5 shrink-0" aria-hidden="true" />
          <h2 id="yearly-plans-heading" className="text-base font-bold uppercase tracking-wider text-cyan-300">
            2. Annual Subscriptions &amp; Refund Window
          </h2>
        </div>
        <p>
          Yourbody subscriptions (such as Personal, Coach, and Coach Pro plans) are billed on an annual basis in advance via Stripe.
        </p>
        <p>
          If you purchase or renew an annual subscription and decide within 30 days that the Service is not right for you, contact us within that 30-day window and we will issue a full refund for that payment.
        </p>
        <p className="text-zinc-400 text-xs">
          After the 30-day window has passed, refunds for unused time in an annual term are considered on a case-by-case basis.
        </p>
      </section>

      {/* 3. Examples of Refunds We Grant */}
      <section aria-labelledby="examples-heading" className="space-y-4">
        <h2 id="examples-heading" className="text-lg font-bold text-white tracking-wide">
          3. Examples of Refunds We Grant
        </h2>
        <div className="space-y-3">
          <div className="flex gap-3 bg-zinc-950/40 border border-zinc-800/60 rounded-xl p-3.5">
            <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <strong className="text-zinc-100 block mb-0.5">Accidental Renewal:</strong>
              <span className="text-zinc-300">
                If your annual subscription just renewed automatically but you meant to cancel, let us know within a reasonable timeframe and we will gladly refund the renewal charge.
              </span>
            </div>
          </div>
          <div className="flex gap-3 bg-zinc-950/40 border border-zinc-800/60 rounded-xl p-3.5">
            <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <strong className="text-zinc-100 block mb-0.5">Not Satisfied:</strong>
              <span className="text-zinc-300">
                If you tried the paid service and found that it did not meet your training expectations within your first 30 days, we will issue a full refund.
              </span>
            </div>
          </div>
          <div className="flex gap-3 bg-zinc-950/40 border border-zinc-800/60 rounded-xl p-3.5">
            <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <strong className="text-zinc-100 block mb-0.5">Extended Service Outage:</strong>
              <span className="text-zinc-300">
                If our servers experience prolonged downtime or technical failure that prevents you from accessing your data for multiple consecutive days, we will credit or partially refund your billing period.
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 4. International Availability Notice */}
      <section aria-labelledby="international-heading" className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2 text-amber-300">
          <Globe className="w-5 h-5 shrink-0" aria-hidden="true" />
          <h2 id="international-heading" className="text-base font-bold uppercase tracking-wider text-amber-300">
            4. European Union &amp; UK Availability
          </h2>
        </div>
        <p className="text-zinc-300">
          Please be advised that paid subscriptions and commercial purchases originating from the European Union (EU) or United Kingdom (UK) may currently be unavailable while our international consumer and value-added tax compliance systems are being updated.
        </p>
      </section>

      {/* 5. Cancellation Process */}
      <section aria-labelledby="cancellation-heading" className="space-y-3">
        <h2 id="cancellation-heading" className="text-lg font-bold text-white tracking-wide">
          5. How to Cancel
        </h2>
        <p>
          You can cancel your subscription at any time directly through the app&rsquo;s Settings view. Once cancelled, you will retain full access to your subscription tier until the end of your prepaid annual cycle, after which no further renewal charges will occur.
        </p>
      </section>

      {/* 6. Requesting a Refund */}
      <section aria-labelledby="request-heading" className="border-t border-zinc-800 pt-6 space-y-3">
        <div className="flex items-center gap-2 text-zinc-100">
          <HelpCircle className="w-5 h-5 text-cyan-400 shrink-0" aria-hidden="true" />
          <h2 id="request-heading" className="text-base font-bold text-white tracking-wide">
            6. How to Request a Refund
          </h2>
        </div>
        <p>
          To request a refund, please send an email to{' '}
          <a
            href="mailto:support@yourbody.fyi"
            className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 font-semibold"
          >
            support@yourbody.fyi
          </a>{' '}
          from the email address associated with your Yourbody account. Please include your account email and a brief description of the issue. Our support team reviews all requests promptly.
        </p>
      </section>
    </LegalLayout>
  );
};
