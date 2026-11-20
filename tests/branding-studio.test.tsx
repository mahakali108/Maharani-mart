import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Page from '@/app/admin/branding/page';
import { recordBrand } from '@/app/admin/branding/actions';
const { rpc, guard, from } = vi.hoisted(() => ({ rpc: vi.fn(), guard: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({createClient: async()=>({rpc,from})}));
vi.mock('@/lib/admin/control-center/guard',()=>({requireSuperAdminPage:guard,requireSuperAdmin:guard}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('next/navigation',()=>({redirect:(path:string)=>{throw Error(path);}}));
it.each(['error','exception'])('uncertain RPC %s redirects to read-only verification without a retry',async mode=>{
  rpc.mockClear(); if(mode==='error') rpc.mockResolvedValueOnce({error:{message:'network'}});else rpc.mockRejectedValueOnce(Error('network'));
  const f=new FormData();f.set('revision','7');f.set('expected','2');
  await expect(recordBrand(f)).rejects.toThrow('/admin/branding?verify=1');expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc.mock.calls[0]?.[1]).toMatchObject({p_source:7,p_expected:2});expect(guard).toHaveBeenCalled();
});
it('renders the live revision independently of the history cursor, pages safely, and disables retry in verification mode',async()=>{
  const row=(id:number)=>({id,stage:'draft',operation:'draft',display_name:`Name ${id}`,tagline:'Tag'});
  const history=Array.from({length:51},(_,i)=>row(100-i));
  const lt=vi.fn();
  function query(){let published=false;const q={select:()=>q,order:()=>q,lt:(...args:unknown[])=>{lt(...args);return q;},eq:()=>{published=true;return q;},limit:()=>q,returns:()=>({data:published?[{...row(1),stage:'published'}]:history})};return q;}
  from.mockImplementation(query);
  const render=async(verify?:string)=>renderToStaticMarkup(await Page({searchParams:Promise.resolve({before:'101',verify})}));
  const html=await render();expect(lt).toHaveBeenCalledWith('id',101);expect(html).toContain('Revision #1: Name 1');expect(html).toContain('before=51');expect(html).toContain('Publish draft #100');expect(html).not.toContain('Publish draft #50');
  const verify=await render('1');expect(verify).toContain('Refresh history');expect(verify).not.toContain('<form');
});
