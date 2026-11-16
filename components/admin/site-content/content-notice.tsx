/**
 * Outcome banner for the website content module. Rendered only inside
 * /admin/content, never on a public page.
 */
const NOTICES: Record<string, string> = {
  saved: 'Draft saved. The published page has not changed yet.',
  published: 'Published. Customers now see this version.',
  unpublished: 'Unpublished. Customers now see a short “not available” message.',
  deleted: 'Page deleted.',
  'order-updated': 'Section order updated.',
  restored:
    'Revision restored into the draft. The published page has not changed — review it in Preview, then publish when you are ready.',
};

export function ContentNotice({ notice, error }: { notice?: string; error?: string }) {
  if (error) {
    return (
      <div role="alert" className="rounded-2xl border border-error-200 bg-error-50 p-4 text-sm text-error-900">
        <p className="font-semibold">That change was not saved</p>
        <p className="mt-1">{error}</p>
      </div>
    );
  }
  const message = notice ? NOTICES[notice] : undefined;
  if (!message) return null;
  return (
    <div role="status" className="rounded-2xl border border-mint-200 bg-mint-50 p-4 text-sm text-mint-900">
      {message}
    </div>
  );
}
