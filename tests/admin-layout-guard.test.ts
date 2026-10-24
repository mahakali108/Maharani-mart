/**
 * Admin layout defence-in-depth.
 *
 * 35 admin pages do not call a page-level guard themselves; before this test
 * existed the /admin layout only proved "somebody is signed in", so those
 * pages relied entirely on middleware.ts to keep retailers, staff, salesmen
 * and sellers out of the admin area. These cases pin the layout-level role
 * check that now backs it up.
 *
 * The mock shape follows tests/retailer-home-auth.test.ts: `redirect()` is
 * mocked to throw, because the real Next.js implementation throws too — any
 * code after it must be unreachable.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminLayout from '@/app/admin/layout';

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), redirect: vi.fn() }));

vi.mock('@/lib/auth/session', () => ({ requireUser: mocks.requireUser }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/components/layout/admin-shell', () => ({
  AdminShell: (props: { fullName: string; role: string; children: unknown }) => props,
}));

const user = (role: string) => ({ id: 'user-1', email: null, fullName: 'Fixture Admin', role });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
});

describe('admin layout role gate', () => {
  it.each(['admin', 'super_admin'])('renders the admin shell for %s', async (role) => {
    mocks.requireUser.mockResolvedValue(user(role));
    const shell = await AdminLayout({ children: 'content' });
    expect(shell.props).toMatchObject({ fullName: 'Fixture Admin', role });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each(['retailer', 'staff', 'salesman', 'seller'])(
    'redirects %s to /unauthorized before rendering anything',
    async (role) => {
      mocks.requireUser.mockResolvedValue(user(role));
      await expect(AdminLayout({ children: 'content' })).rejects.toThrow('redirect:/unauthorized');
      expect(mocks.redirect).toHaveBeenCalledWith('/unauthorized');
    }
  );

  it('propagates the session guard result instead of swallowing it', async () => {
    mocks.requireUser.mockRejectedValue(new Error('redirect:/login'));
    await expect(AdminLayout({ children: 'content' })).rejects.toThrow('redirect:/login');
  });
});
