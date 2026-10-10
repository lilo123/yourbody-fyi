import React from 'react';
import { LegalLayout } from './LegalLayout';
import { Shield, Database, Lock, EyeOff, Server } from 'lucide-react';

export const PrivacyPage: React.FC = () => {
  return (
    <LegalLayout
      title="Privacy Policy"
      description="This Privacy Policy describes what personal data Yourbody collects, how it is used and stored, who it is shared with, and your choices regarding your information."
    >
      {/* 1. Introduction */}
      <section aria-labelledby="privacy-intro-heading" className="space-y-3">
        <h2 id="privacy-intro-heading" className="text-lg font-bold text-white tracking-wide">
          1. Introduction
        </h2>
        <p>
          At Yourbody (&ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;), we take your personal privacy seriously. We operate a fitness and nutrition tracking platform designed to help you achieve your physical goals while putting you in full control of your personal data.
        </p>
        <p>
          If you have any questions about this Privacy Policy, our data practices, or exercising your privacy rights, please contact our privacy officer at{' '}
          <strong>[PRIVACY EMAIL]</strong>
          .
        </p>
      </section>

      {/* 2. Information We Collect */}
      <section aria-labelledby="data-collected-heading" className="space-y-4">
        <div className="flex items-center gap-2 text-cyan-300">
          <Database className="w-5 h-5 shrink-0" aria-hidden="true" />
          <h2 id="data-collected-heading" className="text-lg font-bold text-white tracking-wide">
            2. Information We Collect
          </h2>
        </div>
        <p>
          We collect only the information necessary to provide, personalize, and secure the Yourbody service:
        </p>
        <ul className="space-y-3 pl-1">
          <li className="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-3.5">
            <strong className="text-zinc-100 block mb-1">Account Email:</strong>
            When you register, we collect your email address for authentication, account recovery, password resets, and critical transactional notifications.
          </li>
          <li className="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-3.5">
            <strong className="text-zinc-100 block mb-1">Workout &amp; Nutrition Logs:</strong>
            We store the workout sessions, exercises, sets, weights, repetitions, routines, food items, meal logs, calories, and macronutrient targets that you record within the app.
          </li>
          <li className="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-3.5">
            <strong className="text-zinc-100 block mb-1">Optional Meal Photos:</strong>
            If you choose to use the AI meal photo scanning feature, the photo you submit is sent securely to our AI analysis endpoint solely to identify food items and estimate nutritional content. Meal photos are processed ephemerally and are not stored by us beyond processing.
          </li>
          <li className="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-3.5">
            <strong className="text-zinc-100 block mb-1">Timezone:</strong>
            We store your device timezone so workout sessions, daily macro targets, rest timers, and historical timelines reflect your actual local calendar day.
          </li>
          <li className="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-3.5">
            <strong className="text-zinc-100 block mb-1">Device-Local Offline Storage:</strong>
            We utilize browser storage (IndexedDB and localStorage) directly on your device to cache your recent workouts, exercises, and pending sync items. This allows the application to work offline and synchronize seamlessly when a network connection is restored.
          </li>
          <li className="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-3.5">
            <strong className="text-zinc-100 block mb-1">Error Reports with No User Identifiers:</strong>
            We collect diagnostic crash logs and runtime error reports via Sentry to identify bugs and maintain platform reliability. These reports are strictly anonymized and contain no user identifiers or personal details.
          </li>
        </ul>
      </section>

      {/* 3. Purposes of Processing & Legal Bases */}
      <section aria-labelledby="purposes-heading" className="space-y-3">
        <h2 id="purposes-heading" className="text-lg font-bold text-white tracking-wide">
          3. Purposes and Legal Bases
        </h2>
        <p>
          We use your information for the following specific purposes:
        </p>
        <ul className="list-disc list-inside space-y-1.5 pl-1 text-zinc-300">
          <li>Providing and operating the core workout and nutrition tracking features.</li>
          <li>Synchronizing data across your devices and enabling offline operation.</li>
          <li>Processing AI nutrition estimations at your explicit request.</li>
          <li>Enabling optional coach-athlete roster sharing when opted into by both parties.</li>
          <li>Handling billing and subscription management via Stripe.</li>
          <li>Detecting and mitigating security threats and system errors.</li>
        </ul>
        <div className="bg-zinc-950/60 border border-zinc-800 rounded-xl p-4 mt-3 space-y-2">
          <p className="font-semibold text-zinc-200">
            European Economic Area (EEA) and UK Legal Bases:
          </p>
          <p>
            For users located in the EEA, UK, or Switzerland, we process personal data under the following legal bases: [LEGAL BASES].
          </p>
        </div>
      </section>

      {/* 4. Subprocessors List */}
      <section aria-labelledby="subprocessors-heading" className="space-y-4">
        <div className="flex items-center gap-2 text-cyan-300">
          <Server className="w-5 h-5 shrink-0" aria-hidden="true" />
          <h2 id="subprocessors-heading" className="text-lg font-bold text-white tracking-wide">
            4. Subprocessors and Third-Party Services
          </h2>
        </div>
        <p>
          To deliver our services reliably, we engage trusted third-party service providers (&ldquo;subprocessors&rdquo;). Each subprocessor is vetted for strict security and data protection standards:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border border-zinc-800 rounded-xl overflow-hidden">
            <thead className="bg-zinc-950 text-zinc-300 font-bold uppercase tracking-wider border-b border-zinc-800">
              <tr>
                <th scope="col" className="p-3">Subprocessor</th>
                <th scope="col" className="p-3">Role &amp; Function</th>
                <th scope="col" className="p-3">Location / Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 text-zinc-300">
              <tr>
                <td className="p-3 font-semibold text-white">Supabase</td>
                <td className="p-3">Database hosting, user authentication, edge functions, and backend storage.</td>
                <td className="p-3 text-zinc-400">United States</td>
              </tr>
              <tr>
                <td className="p-3 font-semibold text-white">Google Gemini API</td>
                <td className="p-3">AI meal parsing and nutritional macro estimation from text descriptions and user-submitted photos.</td>
                <td className="p-3 text-zinc-400">United States</td>
              </tr>
              <tr>
                <td className="p-3 font-semibold text-white">Stripe</td>
                <td className="p-3">Payment processing, subscription billing, and tax handling. We do not store credit card numbers.</td>
                <td className="p-3 text-zinc-400">United States</td>
              </tr>
              <tr>
                <td className="p-3 font-semibold text-white">Sentry</td>
                <td className="p-3">Application crash logging and error telemetry (configured with no user identifiers).</td>
                <td className="p-3 text-zinc-400">United States</td>
              </tr>
              <tr>
                <td className="p-3 font-semibold text-white">Cloudflare and Vercel</td>
                <td className="p-3">Edge network routing, CDN content delivery, web hosting, and SSL protection.</td>
                <td className="p-3 text-zinc-400">Global / United States</td>
              </tr>
              <tr>
                <td className="p-3 font-semibold text-white">Resend</td>
                <td className="p-3">Transactional email delivery (account confirmations, email verifications, password resets).</td>
                <td className="p-3 text-zinc-400">United States</td>
              </tr>
              <tr>
                <td className="p-3 font-semibold text-white">PostHog</td>
                <td className="p-3">Product analytics (cookieless product usage insights; marked as planned).</td>
                <td className="p-3 text-zinc-400">Planned</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 5. Cookies and Storage */}
      <section aria-labelledby="cookies-heading" className="space-y-3">
        <div className="flex items-center gap-2 text-zinc-100">
          <EyeOff className="w-5 h-5 text-cyan-400 shrink-0" aria-hidden="true" />
          <h2 id="cookies-heading" className="text-lg font-bold text-white tracking-wide">
            5. Cookies and Local Storage
          </h2>
        </div>
        <p>
          <strong className="text-zinc-100">No advertising or tracking cookies:</strong> We do not use third-party advertising cookies, behavioural profiling trackers, or cross-site tracking scripts.
        </p>
        <p>
          We use only essential cookies and device-local storage (IndexedDB and localStorage) strictly required to keep you signed in, remember your user interface preferences, and support offline workout logging.
        </p>
      </section>

      {/* 6. Retention and Deletion */}
      <section aria-labelledby="retention-heading" className="space-y-3">
        <div className="flex items-center gap-2 text-zinc-100">
          <Lock className="w-5 h-5 text-cyan-400 shrink-0" aria-hidden="true" />
          <h2 id="retention-heading" className="text-lg font-bold text-white tracking-wide">
            6. Retention and Deletion
          </h2>
        </div>
        <p>
          We retain your workout, nutrition, and account records for as long as your account remains active.
        </p>
        <ul className="list-disc list-inside space-y-2 pl-1 text-zinc-300">
          <li>
            <strong className="text-zinc-100">Account deletion:</strong> You can delete your account at any time. When an account is deleted, your personal profile, workout logs, nutrition logs, and routine templates are permanently removed from active databases.
          </li>
          <li>
            <strong className="text-zinc-100">Data exports available:</strong> You have the right to obtain and export a full copy of your data. A complete export in JSON or CSV format can be downloaded at any time directly in Settings under &ldquo;Data Extract&rdquo;.
          </li>
        </ul>
      </section>

      {/* 7. Children's Privacy */}
      <section aria-labelledby="children-heading" className="space-y-3">
        <div className="flex items-center gap-2 text-zinc-100">
          <Shield className="w-5 h-5 text-cyan-400 shrink-0" aria-hidden="true" />
          <h2 id="children-heading" className="text-lg font-bold text-white tracking-wide">
            7. Children&rsquo;s Privacy
          </h2>
        </div>
        <p>
          The Service is strictly not directed to children under 16 years of age. We do not knowingly collect or solicit personal information from anyone under the age of 16. If we become aware that a child under 16 has created an account or provided us with personal information, we will promptly delete that account and associated data.
        </p>
      </section>

      {/* 8. Contact Information */}
      <section aria-labelledby="privacy-contact-heading" className="border-t border-zinc-800 pt-6 space-y-2">
        <h2 id="privacy-contact-heading" className="text-base font-bold text-white tracking-wide">
          8. Contact Us
        </h2>
        <p>
          If you have any questions, concerns, or requests regarding this Privacy Policy or your personal information, please email our privacy team at{' '}
          <strong>[PRIVACY EMAIL]</strong>
          .
        </p>
      </section>
    </LegalLayout>
  );
};
