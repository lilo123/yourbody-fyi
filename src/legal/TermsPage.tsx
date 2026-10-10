import React from 'react';
import { Link } from 'react-router-dom';
import { LegalLayout } from './LegalLayout';
import { Sparkles, HeartPulse, ShieldCheck } from 'lucide-react';

export const TermsPage: React.FC = () => {
  return (
    <LegalLayout
      title="Terms of Service"
      description="These Terms of Service govern your use of the Yourbody fitness and nutrition tracking platform. Please read them carefully before using our services."
    >
      {/* 1. Health Disclaimer */}
      <section aria-labelledby="health-disclaimer-heading" className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2 text-amber-300">
          <HeartPulse className="w-5 h-5 shrink-0" aria-hidden="true" />
          <h2 id="health-disclaimer-heading" className="text-base font-bold uppercase tracking-wider text-amber-300">
            Health Disclaimer
          </h2>
        </div>
        <p className="text-zinc-200 font-semibold">
          Yourbody is not medical advice.
        </p>
        <p className="text-zinc-300">
          The Yourbody application, services, and content are provided for general educational, fitness, and nutritional tracking purposes only. They do not constitute medical, health, dietary, or clinical advice, diagnosis, or treatment.
        </p>
        <ul className="list-disc list-inside space-y-1 text-zinc-300 pl-1">
          <li>
            <strong className="text-zinc-100">Nutrition estimates may be inaccurate:</strong> All nutrition calculations, food databases, calorie counts, and macronutrient targets—including AI-generated estimates from text descriptions or uploaded meal photos—are approximations only and may contain errors or inaccuracies.
          </li>
          <li>
            <strong className="text-zinc-100">Consult a qualified healthcare professional:</strong> Always consult your physician, registered dietitian, or qualified medical provider before starting any exercise program, changing your diet, or making health decisions based on data tracked in Yourbody. Never disregard professional medical advice or delay seeking it because of information found in the service.
          </li>
          <li>
            <strong className="text-zinc-100">Not for medical emergencies:</strong> Yourbody is not monitored for emergency response. If you believe you may have a medical emergency, call your local emergency services (such as 911 or 112) or go to the nearest emergency room immediately.
          </li>
        </ul>
      </section>

      {/* 2. Company & Agreement */}
      <section aria-labelledby="agreement-heading" className="space-y-3">
        <h2 id="agreement-heading" className="text-lg font-bold text-white tracking-wide">
          1. Agreement and Operator
        </h2>
        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) represent a binding legal agreement between you and Yourbody (&ldquo;Operator&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;), governing your access to and use of Yourbody (located at https://www.yourbody.fyi) and any related applications, web interfaces, and tools (collectively, the &ldquo;Service&rdquo;).
        </p>
        <p>
          When we say &ldquo;You&rdquo; or &ldquo;your&rdquo;, we refer to individuals who create an account or otherwise use the Service. By accessing or using Yourbody, you agree to be bound by these Terms and our related policies. If you do not agree to these Terms, you may not use the Service.
        </p>
      </section>

      {/* 3. Account Terms */}
      <section aria-labelledby="account-terms-heading" className="space-y-3">
        <h2 id="account-terms-heading" className="text-lg font-bold text-white tracking-wide">
          2. Account Terms
        </h2>
        <ul className="list-disc list-inside space-y-2 pl-1">
          <li>
            <strong className="text-zinc-100">Human accounts only:</strong> Accounts registered by &ldquo;bots&rdquo; or automated methods are not permitted.
          </li>
          <li>
            <strong className="text-zinc-100">Account security:</strong> You are responsible for maintaining the confidentiality of your login credentials and for all activities that occur under your account. We cannot and will not be liable for any loss or damage arising from your failure to safeguard your account.
          </li>
          <li>
            <strong className="text-zinc-100">Age requirement:</strong> You must be at least 16 years of age to register for and use the Service.
          </li>
          <li>
            <strong className="text-zinc-100">Accuracy of information:</strong> You agree to provide true and accurate information during registration and keep your account details current.
          </li>
        </ul>
      </section>

      {/* 4. AI-Generated Estimates Disclaimer */}
      <section aria-labelledby="ai-disclaimer-heading" className="bg-cyan-500/10 border border-cyan-500/20 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2 text-cyan-300">
          <Sparkles className="w-5 h-5 shrink-0" aria-hidden="true" />
          <h2 id="ai-disclaimer-heading" className="text-base font-bold uppercase tracking-wider text-cyan-300">
            3. AI-Generated Estimates Disclaimer
          </h2>
        </div>
        <p>
          Yourbody integrates artificial intelligence capabilities (including the Google Gemini API) to allow users to describe meals in natural language or submit meal photos for automated nutritional parsing and macronutrient estimates.
        </p>
        <p>
          You acknowledge and agree that AI-generated estimates are produced by machine learning models based on probabilistic calculations and visual patterns. They are inherently prone to approximations, misidentifications, and potential inaccuracies. We make no warranty regarding the completeness, precision, or suitability of AI nutrition data. You retain sole responsibility for reviewing and verifying logged meals, quantities, and nutritional values.
        </p>
      </section>

      {/* 5. Acceptable Use */}
      <section aria-labelledby="acceptable-use-heading" className="space-y-3">
        <h2 id="acceptable-use-heading" className="text-lg font-bold text-white tracking-wide">
          4. Acceptable Use
        </h2>
        <p>
          You agree to use the Service in compliance with all applicable laws and regulations. You agree not to:
        </p>
        <ul className="list-disc list-inside space-y-1.5 pl-1">
          <li>Use the Service for any unlawful, harassing, or fraudulent purpose.</li>
          <li>Interfere with, disrupt, or compromise the integrity or security of the Service, servers, or connected networks.</li>
          <li>Circumvent or attempt to circumvent authentication mechanisms, access controls, or usage bounds.</li>
          <li>Reverse engineer, decompile, dissemble, or attempt to extract the source code of any proprietary portion of the Service.</li>
          <li>Transmit malicious code, viruses, worms, or disruptive scripts through the Service.</li>
        </ul>
      </section>

      {/* 6. Subscriptions, Stripe Billing, and Cancellation */}
      <section aria-labelledby="billing-heading" className="space-y-3">
        <h2 id="billing-heading" className="text-lg font-bold text-white tracking-wide">
          5. Subscriptions, Billing, and Cancellation
        </h2>
        <p>
          Certain features and tiers of the Service (such as Basic and Pro plans) require a paid subscription.
        </p>
        <ul className="list-disc list-inside space-y-2 pl-1">
          <li>
            <strong className="text-zinc-100">Annual billing:</strong> Paid subscriptions are billed on a yearly basis in advance via Stripe. All payment transactions are handled directly by Stripe in accordance with Stripe&rsquo;s terms and security standards.
          </li>
          <li>
            <strong className="text-zinc-100">Automatic renewal:</strong> Subscriptions automatically renew at the end of each annual billing cycle unless you cancel your subscription prior to the renewal date.
          </li>
          <li>
            <strong className="text-zinc-100">Cancellation at any time:</strong> You may cancel your subscription at any time via your account settings. When you cancel, your subscription will not renew, and your cancellation will become effective at the end of your current paid billing period. You will continue to have access to paid features until that period ends.
          </li>
          <li>
            <strong className="text-zinc-100">Refunds:</strong> Subscriptions are subject to our <Link to="/refunds" className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2">Refund Policy</Link>.
          </li>
        </ul>
      </section>

      {/* 7. Account Termination */}
      <section aria-labelledby="termination-heading" className="space-y-3">
        <h2 id="termination-heading" className="text-lg font-bold text-white tracking-wide">
          6. Account Termination
        </h2>
        <p>
          You are solely responsible for properly canceling your account. You may terminate your account at any time through the application interface or by contacting support.
        </p>
        <p>
          Upon cancellation, your data will become inaccessible, and permanent deletion of your account logs will follow the timelines outlined in our <Link to="/privacy" className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2">Privacy Policy</Link>. You can export your workout, nutrition, and routine data before termination using the data export tool in Settings.
        </p>
        <p>
          We reserve the right to suspend or terminate your account and refuse current or future use of the Service for any violation of these Terms, abusive conduct toward other users or staff, or fraudulent activity.
        </p>
      </section>

      {/* 8. Intellectual Property & Content Ownership */}
      <section aria-labelledby="ip-heading" className="space-y-3">
        <h2 id="ip-heading" className="text-lg font-bold text-white tracking-wide">
          7. Intellectual Property & Content Ownership
        </h2>
        <p>
          You retain all ownership rights to the workout logs, nutrition records, custom exercises, routines, and content you submit to the Service. By submitting content, you grant us a worldwide, non-exclusive, royalty-free license to host, store, and process that content solely as necessary to operate and deliver the Service to you.
        </p>
        <p>
          The Yourbody application, including visual interfaces, software, branding, and graphics, is the property of Yourbody or its licensors and is protected by applicable copyright, trademark, and intellectual property laws.
        </p>
      </section>

      {/* 9. Disclaimer of Warranties and Limitation of Liability */}
      <section aria-labelledby="liability-heading" className="space-y-3">
        <div className="flex items-center gap-2 text-zinc-100">
          <ShieldCheck className="w-5 h-5 text-cyan-400 shrink-0" aria-hidden="true" />
          <h2 id="liability-heading" className="text-lg font-bold text-white tracking-wide">
            8. Limitation of Liability
          </h2>
        </div>
        <p className="text-xs uppercase tracking-wider text-zinc-400 font-bold">
          Please read this section carefully as it limits our liability.
        </p>
        <p>
          The Service is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis without warranties of any kind, whether express, implied, or statutory, including but not limited to implied warranties of merchantability, fitness for a particular purpose, and non-infringement.
        </p>
        <p>
          To the maximum extent permitted by applicable law, in no event shall Yourbody, its contributors, service providers, or affiliates be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits, data, use, or goodwill, arising out of or related to your use of or inability to use the Service, whether based on contract, tort (including negligence), or any other legal theory.
        </p>
      </section>

      {/* 10. Governing Law */}
      <section aria-labelledby="governing-law-heading" className="space-y-3">
        <h2 id="governing-law-heading" className="text-lg font-bold text-white tracking-wide">
          9. Governing Law
        </h2>
        <p>
          These Terms and any dispute or claim arising out of or relating to them or the Service shall be governed by and construed in accordance with the laws of the Province of Ontario and the federal laws of Canada applicable therein, without giving effect to any choice or conflict of law provision or rule. Any legal suit, action, or proceeding arising out of or related to these Terms or the Service shall be instituted exclusively in the courts of Ontario, Canada.
        </p>
      </section>

      {/* 11. Contact */}
      <section aria-labelledby="contact-heading" className="border-t border-zinc-800 pt-6 space-y-2">
        <h2 id="contact-heading" className="text-base font-bold text-white tracking-wide">
          10. Contact Us
        </h2>
        <p>
          If you have questions, feedback, or concerns regarding these Terms of Service, please reach out to our team at{' '}
          <a
            href="mailto:support@yourbody.fyi"
            className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 font-semibold"
          >
            support@yourbody.fyi
          </a>
          .
        </p>
      </section>
    </LegalLayout>
  );
};
