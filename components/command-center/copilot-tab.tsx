import { MaharaniAIChat } from '@/components/ai/maharani-ai-chat';

/**
 * AI Super Admin Copilot.
 *
 * Uses the existing, battle-tested agent + provider + safety stack
 * (authenticateAIRequest → role-gated tool allowlist → zod-validated
 * READ-only tools → RLS-scoped Supabase → anti-hallucination system
 * prompt). The page hosting this tab requires the super_admin-only
 * `command_center.view` permission, and the executive tools themselves are
 * additionally registered for the `super_admin` role only — so a non-super
 * admin session can neither open this tab nor execute the executive tools.
 */
export function CopilotTab() {
  return (
    <MaharaniAIChat
      surface="admin"
      title="Maharani AI — Super Admin Command Copilot"
      subtitle="Executive intelligence for the whole distribution business. Verified data, calculated metrics, forecasts and recommendations are always labelled separately — and nothing is changed without the existing human workflow."
      quickActions={[
        { label: 'What is happening today?', prompt: 'What is happening in my business today?' },
        { label: 'Reorder list', prompt: 'Which products should I reorder right now, and why?' },
        { label: 'Stock-out risk', prompt: 'Which products are likely to stock out, and when?' },
        { label: 'Expiry risk', prompt: 'Which products have expiry risk?' },
        { label: 'Falling retailers', prompt: 'Which retailers have falling sales?' },
        { label: 'Credit risk', prompt: 'Who is over their credit limit and what should I do?' },
        { label: 'Best salesman', prompt: 'Which salesman is performing best this month?' },
        { label: 'Growing brands', prompt: 'Which brands are growing in the last 30 days?' },
        { label: 'Where are we losing?', prompt: 'Where are we losing sales?' },
        { label: 'Biggest risks', prompt: "What are my biggest business risks right now?" },
        { label: "Today's action plan", prompt: "Give me today's action plan, prioritized." },
      ]}
    />
  );
}
