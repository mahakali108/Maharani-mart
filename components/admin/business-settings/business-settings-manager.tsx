'use client';

import { useState, useTransition } from 'react';
import { Building2, ShieldAlert, CheckCircle2, Clock, FileCheck, Save } from 'lucide-react';
import type {
  BusinessProfileConfig,
  ContactGrievanceConfig,
  MarketplaceComplianceConfig,
} from '@/lib/admin/business-settings/types';
import {
  updateBusinessProfileAction,
  updateContactGrievanceAction,
  updateMarketplaceComplianceAction,
} from '@/lib/admin/business-settings/actions';

interface BusinessSettingsManagerProps {
  initialBusiness: BusinessProfileConfig;
  initialContact: ContactGrievanceConfig;
  initialMarketplace: MarketplaceComplianceConfig;
}

export function BusinessSettingsManager({
  initialBusiness,
  initialContact,
  initialMarketplace,
}: BusinessSettingsManagerProps) {
  const [isPending, startTransition] = useTransition();
  const [business, setBusiness] = useState(initialBusiness);
  const [contact, setContact] = useState(initialContact);
  const [marketplace, setMarketplace] = useState(initialMarketplace);

  const [businessMsg, setBusinessMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [contactMsg, setContactMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [marketplaceMsg, setMarketplaceMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSaveBusiness = (e: React.FormEvent) => {
    e.preventDefault();
    setBusinessMsg(null);
    startTransition(async () => {
      const res = await updateBusinessProfileAction(business, 'Super Admin updated legal business profile');
      if (res.success) {
        setBusinessMsg({ type: 'success', text: 'Business profile and tax identity saved successfully.' });
      } else {
        setBusinessMsg({ type: 'error', text: res.error ?? 'Failed to update business profile.' });
      }
    });
  };

  const handleSaveContact = (e: React.FormEvent) => {
    e.preventDefault();
    setContactMsg(null);
    startTransition(async () => {
      const res = await updateContactGrievanceAction(contact, 'Super Admin updated contact & grievance officer details');
      if (res.success) {
        setContactMsg({ type: 'success', text: 'Contact and Grievance details saved successfully.' });
      } else {
        setContactMsg({ type: 'error', text: res.error ?? 'Failed to update contact particulars.' });
      }
    });
  };

  const handleSaveMarketplace = (e: React.FormEvent) => {
    e.preventDefault();
    setMarketplaceMsg(null);
    startTransition(async () => {
      const res = await updateMarketplaceComplianceAction(marketplace, 'Super Admin updated marketplace compliance and CA gate');
      if (res.success) {
        setMarketplaceMsg({ type: 'success', text: 'Marketplace compliance settings saved successfully.' });
      } else {
        setMarketplaceMsg({ type: 'error', text: res.error ?? 'Failed to update marketplace compliance.' });
      }
    });
  };

  return (
    <div className="space-y-8">
      {/* 1. Legal Entity & Tax Profile */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
              <Building2 className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Legal Business & Tax Profile</h2>
              <p className="text-xs text-slate-500">
                Authoritative legal identity used for tax invoices, GST classification, and compliance filings.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                business.verificationStatus === 'verified'
                  ? 'bg-mint-50 text-mint-700'
                  : business.verificationStatus === 'pending_verification'
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-slate-100 text-slate-600'
              }`}
            >
              {business.verificationStatus === 'verified' ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <Clock className="h-3.5 w-3.5" />
              )}
              {business.verificationStatus.replace(/_/g, ' ').toUpperCase()}
            </span>
          </div>
        </div>

        {businessMsg && (
          <div
            className={`mt-4 rounded-xl p-3 text-xs font-medium ${
              businessMsg.type === 'success' ? 'bg-mint-50 text-mint-800' : 'bg-error-50 text-error-700'
            }`}
          >
            {businessMsg.text}
          </div>
        )}

        <form onSubmit={handleSaveBusiness} className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold text-slate-700">Legal Entity Name</label>
            <input
              type="text"
              value={business.legalEntityName}
              onChange={(e) => setBusiness({ ...business, legalEntityName: e.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700">Public Brand Name</label>
            <input
              type="text"
              value={business.publicBrandName}
              onChange={(e) => setBusiness({ ...business, publicBrandName: e.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700">Business Constitution</label>
            <select
              value={business.businessType}
              onChange={(e) => setBusiness({ ...business, businessType: e.target.value as BusinessProfileConfig['businessType'] })}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
            >
              <option value="proprietorship">Sole Proprietorship</option>
              <option value="partnership">Partnership Firm</option>
              <option value="llp">Limited Liability Partnership (LLP)</option>
              <option value="pvt_ltd">Private Limited Company</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700">Registration State</label>
            <input
              type="text"
              value={business.registrationState}
              onChange={(e) => setBusiness({ ...business, registrationState: e.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700">GSTIN (15 Digits)</label>
            <input
              type="text"
              placeholder="e.g. 10ABCDE1234F1Z5"
              value={business.gstin ?? ''}
              onChange={(e) => setBusiness({ ...business, gstin: e.target.value.toUpperCase() })}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono text-slate-900 focus:border-primary-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700">Permanent Account Number (PAN)</label>
            <input
              type="text"
              placeholder="e.g. ABCDE1234F"
              value={business.pan ?? ''}
              onChange={(e) => setBusiness({ ...business, pan: e.target.value.toUpperCase() })}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono text-slate-900 focus:border-primary-500 focus:outline-none"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-slate-700">Registered Office Address</label>
            <textarea
              rows={2}
              value={business.registeredAddress}
              onChange={(e) => setBusiness({ ...business, registeredAddress: e.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
              required
            />
          </div>

          <div className="sm:col-span-2 flex flex-wrap items-center gap-6 pt-2">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={business.isGstRegistered}
                onChange={(e) => setBusiness({ ...business, isGstRegistered: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              />
              Entity is Registered under GST
            </label>

            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-700">Status:</span>
              <select
                value={business.verificationStatus}
                onChange={(e) => setBusiness({ ...business, verificationStatus: e.target.value as BusinessProfileConfig['verificationStatus'] })}
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-900"
              >
                <option value="unverified">Unverified</option>
                <option value="pending_verification">Pending Verification</option>
                <option value="verified">Verified (Official Certificate on File)</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>

          <div className="sm:col-span-2 flex justify-end pt-3">
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary-700 px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-primary-800 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {isPending ? 'Saving...' : 'Save Legal Business Profile'}
            </button>
          </div>
        </form>
      </section>

      {/* 2. Customer Support & Statutory Grievance Redressal */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-lavender-100 text-primary-800">
              <FileCheck className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Support & Statutory Grievance Desk</h2>
              <p className="text-xs text-slate-500">
                Mandatory under Consumer Protection (E-Commerce) Rules, 2020 and IT Intermediary Rules.
              </p>
            </div>
          </div>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
              contact.isConfigured ? 'bg-mint-50 text-mint-700' : 'bg-amber-50 text-amber-700'
            }`}
          >
            {contact.isConfigured ? 'PUBLISHED' : 'PENDING OWNER INPUT'}
          </span>
        </div>

        {contactMsg && (
          <div
            className={`mt-4 rounded-xl p-3 text-xs font-medium ${
              contactMsg.type === 'success' ? 'bg-mint-50 text-mint-800' : 'bg-error-50 text-error-700'
            }`}
          >
            {contactMsg.text}
          </div>
        )}

        <form onSubmit={handleSaveContact} className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold text-slate-700">Official Support Phone</label>
            <input
              type="text"
              value={contact.officialPhone}
              onChange={(e) => setContact({ ...contact, officialPhone: e.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700">Official Support Email</label>
            <input
              type="email"
              value={contact.supportEmail}
              onChange={(e) => setContact({ ...contact, supportEmail: e.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700">Grievance Officer Full Name</label>
            <input
              type="text"
              value={contact.grievanceOfficerName}
              onChange={(e) => setContact({ ...contact, grievanceOfficerName: e.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700">Grievance Officer Designation</label>
            <input
              type="text"
              value={contact.grievanceOfficerDesignation}
              onChange={(e) => setContact({ ...contact, grievanceOfficerDesignation: e.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700">Grievance Desk Email</label>
            <input
              type="email"
              value={contact.grievanceEmail}
              onChange={(e) => setContact({ ...contact, grievanceEmail: e.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700">Grievance Desk Phone</label>
            <input
              type="text"
              value={contact.grievancePhone}
              onChange={(e) => setContact({ ...contact, grievancePhone: e.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
              required
            />
          </div>

          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-slate-700">Grievance Redressal Office Address</label>
            <textarea
              rows={2}
              value={contact.grievanceAddress}
              onChange={(e) => setContact({ ...contact, grievanceAddress: e.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
              required
            />
          </div>

          <div className="sm:col-span-2 flex items-center gap-2 pt-2">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={contact.isConfigured}
                onChange={(e) => setContact({ ...contact, isConfigured: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              />
              Publish to Public Grievance Page (Uncheck to keep as &quot;Pending Owner Confirmation&quot;)
            </label>
          </div>

          <div className="sm:col-span-2 flex justify-end pt-3">
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary-700 px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-primary-800 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {isPending ? 'Saving...' : 'Save Grievance Particulars'}
            </button>
          </div>
        </form>
      </section>

      {/* 3. Marketplace Compliance & CA Tax Gates */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-800">
              <ShieldAlert className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Marketplace Compliance & CA Tax Gates</h2>
              <p className="text-xs text-slate-500">
                Governs discount funding, seller product moderation, and Section 15(3) Chartered Accountant sign-off.
              </p>
            </div>
          </div>
        </div>

        {marketplaceMsg && (
          <div
            className={`mt-4 rounded-xl p-3 text-xs font-medium ${
              marketplaceMsg.type === 'success' ? 'bg-mint-50 text-mint-800' : 'bg-error-50 text-error-700'
            }`}
          >
            {marketplaceMsg.text}
          </div>
        )}

        <form onSubmit={handleSaveMarketplace} className="mt-5 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={marketplace.productModerationRequired}
                onChange={(e) => setMarketplace({ ...marketplace, productModerationRequired: e.target.checked })}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              />
              <div>
                <p className="text-xs font-semibold text-slate-900">Enforce Mandatory Seller Product Moderation</p>
                <p className="text-[11px] text-slate-500">
                  Seller offers remain hidden from public catalog until approved by Super Admin / Admin.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={marketplace.platformFundedDiscountsAllowed}
                onChange={(e) => setMarketplace({ ...marketplace, platformFundedDiscountsAllowed: e.target.checked })}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              />
              <div>
                <p className="text-xs font-semibold text-slate-900">Platform-Funded Discounts Permitted</p>
                <p className="text-[11px] text-slate-500">
                  Maharani Traders absorbs membership discount cost without deducting from 3rd-party seller offer payout.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={marketplace.sellerFundedDiscountsAllowed}
                onChange={(e) => setMarketplace({ ...marketplace, sellerFundedDiscountsAllowed: e.target.checked })}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              />
              <div>
                <p className="text-xs font-semibold text-slate-900">Seller-Funded Discounts Permitted</p>
                <p className="text-[11px] text-slate-500">
                  Requires contractual seller participation agreement before deducting discount from seller settlement.
                </p>
              </div>
            </label>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
              <ShieldAlert className="h-4 w-4 text-amber-700" />
              Statutory CA Sign-Off Gate for Membership Discounts in Checkout
            </div>
            <p className="text-xs text-amber-800 leading-5">
              In accordance with GST Section 15(3) safety protocols, membership discounts CANNOT be activated in live
              checkout until a formal written CA opinion reference is recorded.
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 pt-1">
              <div>
                <label className="text-xs font-semibold text-slate-800">CA Opinion Document Reference</label>
                <input
                  type="text"
                  placeholder="e.g. CA-OPINION-MAHARANI-2026-OCT-15"
                  value={marketplace.caApprovalDocumentReference ?? ''}
                  onChange={(e) => setMarketplace({ ...marketplace, caApprovalDocumentReference: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-900 focus:border-primary-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center pt-5">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={marketplace.membershipDiscountCheckoutActive}
                    onChange={(e) => setMarketplace({ ...marketplace, membershipDiscountCheckoutActive: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                  />
                  Activate Membership Discounts in Checkout
                </label>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary-700 px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-primary-800 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {isPending ? 'Saving...' : 'Save Marketplace Compliance Settings'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
