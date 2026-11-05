/** Read the database's complete current balance, rather than summing a paginated
 * ledger response. This preserves the current database accounting semantics;
 * it does not repair legacy reversal-flag inconsistencies. Fail closed on a
 * failed, missing, or unsafe integer result instead of displaying zero. */
export type WalletBalanceRpcClient = {
  rpc: (name: string, args: { p_retailer_id: string }) => PromiseLike<{ data: unknown; error: unknown }>
};

export async function readAdminWalletOutstanding(
  client: WalletBalanceRpcClient,
  retailerId: string,
): Promise<number> {
  const { data, error } = await client.rpc('get_retailer_outstanding_paise', { p_retailer_id: retailerId });
  if (error || data === null || data === undefined || (typeof data !== 'number' && typeof data !== 'string')) {
    throw new Error('Retailer wallet balance could not be verified.');
  }
  if (typeof data === 'string' && !/^-?\d+$/.test(data)) {
    throw new Error('Retailer wallet balance is not a valid integer.');
  }
  const amount = Number(data);
  if (!Number.isSafeInteger(amount)) throw new Error('Retailer wallet balance is not a safe integer.');
  return amount;
}
