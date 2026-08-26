import { MaharaniAIChat } from '@/components/ai/maharani-ai-chat';
import { requirePermission } from '@/lib/admin/guard';

export default async function AdminAIPage() {
  await requirePermission('reports.view.all');
  return <MaharaniAIChat surface="admin" title="✨ Maharani Business Copilot" subtitle="Authorized operational intelligence across products, orders, sales and inventory—grounded in current business data." quickActions={[
    { label: 'Sales Summary', prompt: 'Last 30 days sales summary do.' },
    { label: 'Top Products', prompt: 'Last 30 days ke top products dikhao.' },
    { label: 'Slow Products', prompt: 'Last 30 days ke slow-moving sold products dikhao.' },
    { label: 'Low Stock', prompt: 'Low stock aur out-of-stock products dikhao.' },
    { label: 'Expiring Stock', prompt: 'Agle 30 din mein expiring batches dikhao.' },
    { label: 'Inventory Health', prompt: 'Current inventory health aur stock valuation summary do.' },
    { label: 'Pending Orders', prompt: 'Pending orders ka summary do.' },
    { label: 'Reorder Stock', prompt: 'Configured thresholds ke basis par inventory reorder recommendations do.' },
    { label: 'Demand Forecast', prompt: 'Last 60 days ke data se demand forecast banao, rising demand aur stock-out risk highlights karke.' },
    { label: 'Stock-out Risk', prompt: 'Kaunse products next 7 days mein khatam ho sakte hain? Demand forecast se batao.' },
    { label: 'Inventory Risk', prompt: 'Abhi ka complete inventory risk report do — stock-out, overstock, dead-stock aur expiry risk.' },
  ]} />;
}
