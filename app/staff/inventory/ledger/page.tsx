import { StockLedgerList } from '@/components/inventory/stock-ledger-list';

export default async function StaffInventoryLedgerPage({
  searchParams,
}: {
  searchParams: { warehouse?: string };
}) {
  return <StockLedgerList warehouseFilter={searchParams.warehouse ?? ''} permission="inventory.view" />;
}
