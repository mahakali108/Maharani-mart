// Shared by admin and retailer readers; the database remains authoritative.
export { readWalletOutstanding as readAdminWalletOutstanding } from '@/lib/retailer/wallet-balance';
export type { WalletBalanceRpcClient } from '@/lib/retailer/wallet-balance';
