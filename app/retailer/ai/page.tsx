import { MaharaniAIChat } from '@/components/ai/maharani-ai-chat';
import { requireUser } from '@/lib/auth/session';

export default async function RetailerAIPage() {
  await requireUser();
  return <MaharaniAIChat surface="retailer" title="✨ Ask Maharani AI" subtitle="Your wholesale copilot for verified products, pricing, schemes, credit, orders and smart restocking." quickActions={[
    { label: 'Search Products', prompt: 'Mujhe products search karne hain.' },
    { label: 'Best Deals', prompt: 'Mere liye current eligible best deals dikhao.' },
    { label: 'My Reorder', prompt: 'Mere purchase history se reorder suggestions do.' },
    { label: 'My Orders', prompt: 'Mere recent orders dikhao.' },
    { label: 'My Cart', prompt: 'Mera current cart aur GST total dikhao.' },
    { label: 'Best Schemes', prompt: 'Mere liye eligible active schemes kaunsi hain?' },
    { label: 'My Credit', prompt: 'Mera available credit kitna hai?' },
  ]} />;
}
