/**
 * Wording for the policy documents rendered by `app/legal/[slug]/page.tsx`.
 *
 * Drafting rules followed here (keep them when editing):
 *  - Plain language. No promise that the software or the business cannot keep.
 *  - No invented fact: no time window, fee, rate, licence number or contact
 *    detail appears unless it exists in the product or was given by the owner.
 *  - Nothing here removes a right that Indian law does not allow to be removed.
 *  - Owner decisions that are still open are listed in `ownerDecisions` and are
 *    shown on the page, so a reader is never misled by a silent gap.
 */
export type PolicySection = { title: string; paragraphs?: string[]; bullets?: string[] };
export type PolicyContent = {
  intro: string;
  sections: PolicySection[];
  /** Points the owner must confirm before this version is treated as final. */
  ownerDecisions?: string[];
  /** Other policies a reader of this one usually needs. */
  related?: string[];
};

export const POLICY_CONTENT: Record<string, PolicyContent> = {
  'damaged-goods': {
    intro: 'What to do when goods arrive damaged, short, wrong, expired or not as described. This procedure works together with the Cancellation, Return and Refund Policy.',
    sections: [
      {
        title: 'Check the goods at delivery',
        paragraphs: [
          'Delivery is completed with a one-time password (OTP) that only you receive. Please count and inspect the goods before you share the OTP with the delivery person.',
          'If any item is missing or visibly damaged, tell the delivery person before the delivery is completed. They record the missing or damaged quantity against each item, and the delivery is saved as a partial delivery.',
        ],
      },
      {
        title: 'What happens for a shortfall recorded at the door',
        paragraphs: [
          'You pay only for the goods actually delivered. The amount to collect is recalculated from the quantities recorded.',
          'If Coins were applied to goods that were not delivered, the value of that shortfall is credited back to your Coins balance. The system calculates this amount from the recorded quantities; it cannot be typed in by the delivery person.',
        ],
      },
      {
        title: 'Problems found after delivery',
        paragraphs: [
          'Raise a return request from the order page, or contact us using the details below. Each delivered order shows the last date for raising a return request in the app. If that date has passed, you can still contact us: an internal deadline does not take away a remedy the law gives you.',
          'Tell us the order number, the product, the quantity affected and what is wrong. Photographs of the product, the batch number and the outer carton help us act quickly and trace the batch. A missing photograph does not by itself defeat a valid complaint.',
        ],
        bullets: [
          'Damaged in transit or leaking.',
          'Wrong product, wrong variant or wrong quantity.',
          'Expired, or past its “use before” date when delivered.',
          'Seal broken, label missing or label does not match the listing.',
          'Suspected counterfeit or not genuine.',
        ],
      },
      {
        title: 'How we resolve it',
        paragraphs: [
          'After checking the complaint we will offer the remedy that fits the problem: replacement, collection of the goods with a refund, or a price adjustment. For goods sold by an independent seller, we pass the complaint to that seller and follow it up; see the Marketplace Disclaimer.',
          'Please keep the product, its packaging and the invoice until the complaint is closed. Do not use or resell a product you believe is unsafe or not genuine.',
          'Opened or used cosmetics and personal-care products are not accepted back for a change of mind, for hygiene reasons. This does not apply where the product is defective, damaged, wrong, expired or not genuine.',
        ],
      },
    ],
    ownerDecisions: [
      'Confirm the return-request window (the software default is 7 days from delivery; it is not yet set by the owner).',
      'Confirm how refunds for Cash on Delivery orders are paid (Coins credit, bank transfer or cash) and the time taken.',
    ],
    related: ['returns', 'shipping', 'grievance', 'marketplace-disclaimer'],
  },

  'seller-agreement': {
    intro: 'The agreement between Maharani Traders (the marketplace operator) and each independent seller who lists goods on this website. A seller must accept the current version before any offer can go live.',
    sections: [
      {
        title: 'Who can sell',
        paragraphs: [
          'Selling is by invitation only. A seller account is created only from an invitation issued by the Super Admin. There is no public seller sign-up.',
          'Before the account is activated the seller must provide true and current business details and documents for verification, including legal name, business address, GST registration details and PAN where applicable, and bank account details for payouts. The seller must tell us promptly if any of these change.',
          'We may refuse, pause or end onboarding if details cannot be verified.',
        ],
      },
      {
        title: 'What can be listed',
        paragraphs: [
          'Only cosmetics, personal-care and non-food FMCG goods in categories that we have approved may be listed. Food and drink of every kind are not permitted on this website. See the Prohibited and Restricted Products Policy.',
          'Every offer is reviewed before it is shown to buyers. We keep a record of each approval, rejection and suspension and the reason for it.',
        ],
      },
      {
        title: 'Seller’s promises about the goods',
        bullets: [
          'The goods are genuine, lawfully sourced and the seller has the right to sell them.',
          'Cosmetics are made by a licensed manufacturer or lawfully imported, and carry the label particulars required by the Cosmetics Rules, 2020.',
          'Pre-packaged goods carry the declarations required by the Legal Metrology (Packaged Commodities) Rules, 2011, including MRP, net quantity, month and year of manufacture or packing, manufacturer or importer details, consumer-care details and, for imported goods, country of origin.',
          'Goods are not expired, recalled, tampered with or re-labelled, and have a reasonable remaining shelf life when dispatched.',
          'The description, images, price and stock shown on the listing are accurate and are kept up to date.',
          'The seller will give us invoices, licences, test reports or brand authorisations when we ask for them to check a listing or a complaint.',
        ],
      },
      {
        title: 'Orders, delivery and returns',
        paragraphs: [
          'The seller must make the ordered goods ready in the quantity and condition ordered. If the seller cannot fulfil an order it must tell us at once so the buyer can be informed.',
          'The seller is responsible for the goods it sells and must accept back, replace or refund goods that are damaged, defective, wrong, expired, not genuine or not as described, in line with the policies published on this website and with the law.',
          'The seller must name a person who will respond to buyer complaints that we forward, and must respond within the timelines in the Grievance Redressal Policy.',
        ],
      },
      {
        title: 'Prices, taxes, fees and payouts',
        paragraphs: [
          'The seller sets its selling price, which must not exceed the MRP printed on the pack. The seller is the supplier of its goods for GST purposes and is responsible for its own tax invoices, returns and tax payments.',
          'Our commission or fees, and the payout cycle, are those agreed with the seller in writing and recorded against the seller account. Payouts are made after deducting agreed fees, refunds, and any tax that the law requires us to collect or deduct on the seller’s sales, and are shown in the seller ledger.',
          'We may hold a payout for an order that is the subject of an open complaint, return or investigation until it is resolved.',
        ],
      },
      {
        title: 'Buyer data',
        paragraphs: [
          'The seller receives only the buyer information needed to fulfil an order. It must be used only for that order, kept secure, and not used for marketing or shared with anyone else.',
        ],
      },
      {
        title: 'Suspension and ending the agreement',
        paragraphs: [
          'We may remove a listing or suspend a seller where there is a safety concern, a suspected counterfeit, a breach of this agreement or of the law, or a failure to respond to complaints. When a seller is suspended its offers are withdrawn from sale automatically.',
          'Either side may end the agreement by written notice. Orders already accepted, complaints, returns, payouts due and record-keeping duties continue until they are completed. See the Suspension, Termination and Dispute Policy.',
        ],
      },
      {
        title: 'Changes to this agreement',
        paragraphs: [
          'When this agreement changes we publish a new version with a new version number and date. A seller is asked to accept the new version; the version accepted and the time of acceptance are recorded.',
        ],
      },
    ],
    ownerDecisions: [
      'Commission / fee rates and the payout cycle (kept out of this document on purpose; they must be agreed in writing with each seller).',
      'Whether the operator has registered for, and will collect, tax at source on seller sales under section 52 of the CGST Act, and deduct tax under section 194-O of the Income-tax Act. Confirm with a Chartered Accountant before the first third-party sale.',
      'Liability caps, indemnity wording, notice period and governing court: to be settled by a lawyer before the first seller is onboarded.',
    ],
    related: ['prohibited-products', 'marketplace-disclaimer', 'gst-pricing-invoice', 'suspension-termination', 'ip-complaints'],
  },

  'retailer-terms': {
    intro: 'Additional terms for shops and wholesale buyers. They apply together with the general Terms and Conditions.',
    sections: [
      {
        title: 'Who can buy',
        paragraphs: [
          'This website serves retailers and wholesale buyers in the areas we deliver to. An account is reviewed before it can place orders. Please give true shop details, including the shop name, address, mobile number and, if you are registered, your GSTIN.',
          'You are responsible for orders placed from your account. Keep your password private and tell us at once if you think someone else has used your account.',
        ],
      },
      {
        title: 'Prices and your pricing category',
        paragraphs: [
          'Prices, pack sizes, minimum quantities and any quantity slabs are shown before you confirm an order. The price that applies is the one shown at checkout for your account.',
          'Your account may be placed in a pricing category by our team. A category is not a paid membership: there is no fee, no subscription and no renewal. We may change a category, and the change applies to orders placed after it.',
        ],
      },
      {
        title: 'Payment',
        paragraphs: [
          'Orders are paid by Cash on Delivery. Any Coins balance applied is shown at checkout, and the remaining amount is payable to our delivery person when you accept the goods. Pay only against the order shown in the app, and never share your delivery OTP before you have checked the goods.',
        ],
      },
      {
        title: 'Resale',
        bullets: [
          'Sell the goods in their original, unopened packs, with the label intact.',
          'Do not sell above the MRP printed on the pack.',
          'Do not sell goods after the “use before” or expiry date. Store goods as the label directs.',
          'If we tell you about a recall or a safety problem with a batch, stop selling it and follow our instructions.',
        ],
      },
      {
        title: 'Your rights as a business buyer',
        paragraphs: [
          'Some consumer-protection laws apply only to people who buy for personal use and may not apply to goods bought for resale. Whatever the legal position, the complaint, return and grievance procedures published on this website are open to every buyer.',
        ],
      },
    ],
    ownerDecisions: [
      'Whether credit terms are offered to any retailer (this document assumes Cash on Delivery only).',
      'Minimum order value, if any.',
    ],
    related: ['terms', 'returns', 'damaged-goods', 'coins-loyalty', 'gst-pricing-invoice'],
  },

  'marketplace-disclaimer': {
    intro: 'This website sells goods from our own stock and can also show offers from independent sellers. This page explains the difference.',
    sections: [
      {
        title: 'Two kinds of offer',
        paragraphs: [
          'Own stock: goods bought, stored and sold by Maharani Traders. We are the seller and issue the invoice.',
          'Seller offer: goods offered by an independent seller that we have invited and verified. That seller is the seller of those goods and is responsible for their quality, labelling, authenticity and tax invoice. The offer shows the seller’s name.',
        ],
      },
      {
        title: 'What we do for seller offers',
        bullets: [
          'Invite sellers individually and check their business details before they can list.',
          'Review each offer before it is shown, and allow only approved cosmetics and non-food FMCG categories.',
          'Take a written agreement from each seller that goods are genuine and correctly labelled.',
          'Receive your complaints, forward them to the seller, and follow them up to a conclusion.',
          'Remove listings and suspend sellers where we find a problem.',
        ],
      },
      {
        title: 'What we do not do',
        paragraphs: [
          'We do not manufacture any product sold here. We do not make any health, medical or treatment claim for any product. Product descriptions and images for seller offers come from the seller; always read the label on the pack before using or reselling a product.',
          'This page does not limit any liability that the law places on a marketplace operator or on a seller, and it does not limit your right to complain to us about any order placed on this website.',
        ],
      },
    ],
    related: ['seller-agreement', 'product-safety', 'grievance', 'ip-complaints'],
  },

  'gst-pricing-invoice': {
    intro: 'How prices and taxes are shown on this website and what invoice you receive.',
    sections: [
      {
        title: 'Prices',
        paragraphs: [
          'The price for each product, the pack size and the quantity are shown before you place an order, and the order summary shows the total payable. Any delivery or other charge is shown separately before you confirm.',
          'No product is sold above the Maximum Retail Price (MRP) printed on its pack. If a pack you receive shows a lower MRP than the price charged, tell us and we will correct it.',
          'If a price was shown wrongly because of an obvious error, we will contact you before dispatch and you may cancel the order without any charge.',
        ],
      },
      {
        title: 'GST',
        paragraphs: [
          'Where GST applies, it is charged at the rate that applies to the product and is shown in the order summary and on the invoice.',
          'If you want your GSTIN on the invoice, add the correct GSTIN and registered business name to your account before placing the order. We cannot add or change a GSTIN on an invoice that has already been issued, except as the GST law allows.',
        ],
      },
      {
        title: 'Invoices',
        paragraphs: [
          'An invoice or bill is issued for every delivered order by the seller of the goods: by us for own-stock goods, and by the independent seller for seller offers. Where one order contains goods from more than one seller, you may receive more than one invoice.',
          'The app shows a tax invoice only when the registration and tax details needed for a valid tax invoice are complete. Until then the document is marked as an order summary and is not a tax invoice.',
          'For returns and price corrections, a credit note or revised document is issued as the GST law requires.',
        ],
      },
    ],
    ownerDecisions: [
      'GSTIN of the business (the owner reports GST registration; the number has not been supplied, so no tax invoice can be issued yet).',
      'Invoice numbering series and financial-year prefix.',
      'HSN codes and GST rates for every product, confirmed by a Chartered Accountant.',
      'Tax-collection-at-source registration and returns for third-party seller sales, if seller offers are switched on.',
    ],
    related: ['terms', 'retailer-terms', 'seller-agreement', 'business-disclosure'],
  },

  'prohibited-products': {
    intro: 'This website is for cosmetics, personal-care and non-food FMCG goods only. The following may never be listed, whether by us or by a seller.',
    sections: [
      {
        title: 'Never allowed',
        bullets: [
          'Food and drink of any kind, including packaged food, snacks, beverages, baby food, edible oils, spices, confectionery, pan masala and health or nutrition supplements.',
          'Medicines and drugs, including anything that needs a prescription, and products that claim to prevent, treat or cure a disease.',
          'Tobacco, nicotine, e-cigarettes, alcohol and intoxicants.',
          'Counterfeit, replica, smuggled or stolen goods, and goods sold without the brand owner’s authority where that is required.',
          'Cosmetics that are not made by a licensed manufacturer or not lawfully imported, or that contain an ingredient that is not permitted.',
          'Expired, recalled, tampered, re-labelled, repacked or tester/“not for sale” goods.',
          'Goods without the label declarations required by law, or with an altered MRP.',
          'Hazardous, flammable or dangerous goods that cannot be carried safely, and any goods whose sale is prohibited by law.',
        ],
      },
      {
        title: 'How this is enforced',
        paragraphs: [
          'Every product category carries a compliance classification set by the Super Admin. Only categories classified as cosmetics or non-food FMCG can hold products for sale; the database rejects a product or seller offer placed in any other category.',
          'Seller offers are reviewed before they go live, and each decision is recorded with the reviewer and the reason.',
        ],
      },
      {
        title: 'Report a listing',
        paragraphs: [
          'If you see a product here that you believe is prohibited, unsafe or not genuine, tell us using the contact details below. We will review it, and remove it from sale while we check where there is a safety concern.',
        ],
      },
    ],
    related: ['product-safety', 'seller-agreement', 'ip-complaints', 'grievance'],
  },

  'ip-complaints': {
    intro: 'For brand owners and their authorised agents who believe a listing on this website infringes a trade mark, copyright or design, or is counterfeit.',
    sections: [
      {
        title: 'What to send us',
        bullets: [
          'Your name, organisation, address, phone number and email.',
          'The right you rely on (for example the registered trade mark and its registration number) and proof that you own it or are authorised to act.',
          'The exact listing: the product name as shown and the page link.',
          'Why you believe it infringes or is counterfeit.',
          'A statement that the information is true and that you are the owner or authorised by the owner.',
        ],
      },
      {
        title: 'What we do',
        paragraphs: [
          'We acknowledge the complaint, check it, and where it appears valid we remove or disable the listing. For a seller offer we inform the seller, who may reply with evidence such as purchase invoices or a brand authorisation.',
          'If the seller’s reply shows the goods are genuine and lawfully sold, the listing may be restored and we will tell you why. Repeated or serious infringement leads to suspension of the seller.',
          'We keep a record of each complaint and its outcome. Complaints that are knowingly false may be rejected and may lead to restriction of the complainant’s account.',
        ],
      },
      {
        title: 'Our own content',
        paragraphs: [
          'Product names, logos and pack images shown on this website belong to their respective owners and are used only to identify the goods offered for sale.',
        ],
      },
    ],
    related: ['prohibited-products', 'marketplace-disclaimer', 'grievance'],
  },

  'suspension-termination': {
    intro: 'When an account can be restricted or closed, and how a decision or dispute is handled. It applies to buyers and sellers.',
    sections: [
      {
        title: 'When we may restrict or close an account',
        bullets: [
          'False or unverifiable registration details or documents.',
          'Fraud, misuse of Coins, coupons or offers, or attempts to interfere with the website or other accounts.',
          'Repeated refusal of delivered orders or non-payment of Cash on Delivery orders without a valid reason.',
          'Abuse or threats towards our staff, delivery persons or other users.',
          'For sellers: unsafe, counterfeit, mislabelled or prohibited goods, or failure to respond to complaints.',
          'Where the law or an order of a court or authority requires it.',
        ],
      },
      {
        title: 'How we do it',
        paragraphs: [
          'Where it is safe to do so we tell you the reason and give you a chance to explain before a lasting restriction. Where there is a risk to buyers, to payments or to the security of the service, we may act first and tell you afterwards.',
          'Restriction decisions are recorded with the reason and the person who made them.',
        ],
      },
      {
        title: 'Closing your own account',
        paragraphs: [
          'A retailer can ask for account closure from Account → Security in the app, or by contacting us. Open orders, returns and amounts due are settled first.',
          'After closure we delete or anonymise personal data that we no longer need, and keep only what the law requires us to keep, such as invoices and tax and accounting records, for the period the law requires. See the Privacy Policy.',
        ],
      },
      {
        title: 'What continues after closure or suspension',
        paragraphs: [
          'Orders already delivered, complaints, returns, refunds due to you and payments due from you are not cancelled by a suspension or closure. A Coins balance that represents money refunded to you remains yours; ask us how it will be returned.',
        ],
      },
      {
        title: 'Disputes',
        paragraphs: [
          'Start with the Grievance Redressal Policy: most problems are settled there. If you are not satisfied with the outcome you may ask for it to be reviewed by the proprietor.',
          'These policies are governed by the laws of India. Nothing here stops you from approaching a consumer commission, court or authority that has jurisdiction under the law.',
        ],
      },
    ],
    ownerDecisions: [
      'How a remaining Coins balance is paid out when an account is closed.',
      'Whether disputes with sellers go to arbitration or to court, and the place — to be drafted by a lawyer.',
    ],
    related: ['grievance', 'privacy', 'seller-agreement', 'terms'],
  },

  cookies: {
    intro: 'This website stores a small amount of information on your device so that it can work. It does not use advertising cookies.',
    sections: [
      {
        title: 'What is stored and why',
        bullets: [
          'Sign-in session cookies: keep you signed in securely and protect your account. They are necessary; the website cannot work without them.',
          'Device storage for convenience: recently viewed products, recent searches, your product-comparison list and whether you dismissed a notice. This stays on your device and is not used to build an advertising profile.',
          'Offline app files: if you install the website as an app, your browser keeps copies of app files so pages load faster.',
        ],
      },
      {
        title: 'Usage statistics',
        paragraphs: [
          'We use Vercel Web Analytics to count page visits so that we can keep the website working well. According to its provider it does not use cookies and does not identify individual visitors. We do not use it for advertising.',
        ],
      },
      {
        title: 'What we do not use',
        paragraphs: [
          'No advertising cookies, no social-media tracking pixels and no sale of browsing data. If that ever changes, this notice will be updated first and, where the law requires consent, you will be asked before anything is stored.',
        ],
      },
      {
        title: 'Your choices',
        paragraphs: [
          'You can clear cookies and site data in your browser settings at any time. Clearing them signs you out and removes your recently viewed list. Blocking necessary cookies will stop sign-in from working.',
        ],
      },
    ],
    related: ['privacy'],
  },

  'coins-loyalty': {
    intro: 'Coins and loyalty points are two separate records on a retailer account. This page explains each. There is no paid membership on this website.',
    sections: [
      {
        title: 'Coins',
        paragraphs: [
          'Coins are a balance on your account. Coins are added when we credit a refund or adjustment to you, for example for goods that were short or damaged at delivery, or for a cancelled order on which Coins had been used.',
          'At checkout the available Coins balance may be applied to the order automatically, and the amount applied is shown before you confirm. The rest is paid by Cash on Delivery.',
          'If an order is cancelled or returned, Coins used on it are credited back. Each credit is recorded once against the order or delivery, so the same refund cannot be credited twice.',
          'Every Coins entry appears in your account ledger with its date and reason.',
        ],
      },
      {
        title: 'Loyalty points',
        paragraphs: [
          'Loyalty points are added automatically when an order is delivered: 1 point for every full ₹100 of the order. If the order is later returned, the points for it are removed.',
          'Points are a record of your buying activity. They are not money, they have no cash value, they cannot be transferred, and at present they cannot be redeemed against an order. If a redemption scheme is introduced, its terms will be published here first.',
          'Points are only ever added by the system on a verified delivery, or adjusted by an Admin with a recorded reason.',
        ],
      },
      {
        title: 'Corrections and misuse',
        paragraphs: [
          'If you think a Coins or points entry is wrong, contact us with the order number. We will check it against the ledger and correct a genuine error.',
          'We may reverse Coins or points that were credited by mistake or obtained by fraud or misuse, and will record the reason for doing so.',
        ],
      },
    ],
    ownerDecisions: [
      'Whether Coins ever expire (the software sets no expiry; none is stated here).',
      'Whether loyalty points will become redeemable, and on what terms.',
    ],
    related: ['retailer-terms', 'returns', 'suspension-termination'],
  },
};
