-- Draft: preserve the original stock owner when a parent cancellation invokes
-- the simple-stock trigger. 0065 deducts seller-fulfilled lines from seller
-- offers, but the 0054 parent trigger restored every line to product_packs.
-- No historical stock counters or ledgers are rewritten by this migration.
create or replace function public.restore_simple_order_stock(
  p_order_id uuid,
  p_order_item_id uuid default null
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.order_items%rowtype;
  v_restore integer;
  v_restored_total integer := 0;
  v_status public.order_status;
begin
  select status into v_status from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if v_status not in ('cancelled', 'delivered', 'returned') then
    raise exception 'Stock can only be restored for a cancelled or delivered/returned order.' using errcode = 'check_violation';
  end if;

  for v_item in
    select oi.* from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.order_id = p_order_id and o.simple_stock_mode
      and (p_order_item_id is null or oi.id = p_order_item_id)
      and oi.stock_deducted_quantity > oi.stock_restored_quantity
    order by oi.id for update of oi
  loop
    -- Child counters exclude goods still in transit. For unsplit historical
    -- lines retain the original 0054 behaviour exactly.
    if v_item.sub_order_id is null then
      v_restore := v_item.stock_deducted_quantity - v_item.stock_restored_quantity;
    else
      v_restore := v_item.stock_deducted_quantity - v_item.shipped_quantity
                 + v_item.returned_received_quantity - v_item.stock_restored_quantity;
    end if;
    if v_restore <= 0 then continue; end if;

    if v_item.source_type = 'seller' and v_item.fulfilment_type = 'seller' then
      update public.seller_offers so
         set stock_quantity = so.stock_quantity + v_restore, updated_at = now()
       where so.id = v_item.seller_offer_id
         and so.product_id = v_item.product_id and so.pack_id = v_item.pack_id
         and so.fulfilment_type = 'seller'
         and so.stock_quantity <= 2000000000 - v_restore;
      if not found then
        raise exception 'Seller offer stock could not be restored for this order line.' using errcode = 'check_violation';
      end if;
    else
      -- Seller offers fulfilled by Maharani use Maharani stock too.
      if v_item.fulfilment_type = 'seller'
         or (v_item.source_type = 'seller' and v_item.fulfilment_type is null) then
        raise exception 'Ambiguous seller stock ownership for this order line.' using errcode = 'check_violation';
      end if;
      if v_item.pack_id is null then
        raise exception 'The returned order line no longer has a pack reference.' using errcode = 'check_violation';
      end if;
      update public.product_packs pp
         set stock_quantity = pp.stock_quantity + v_restore, updated_at = now()
       where pp.id = v_item.pack_id and pp.product_id = v_item.product_id
         and pp.stock_quantity <= 2000000000 - v_restore;
      if not found then
        if exists (select 1 from public.product_packs where id = v_item.pack_id and product_id = v_item.product_id) then
          raise exception 'Restoring this return would exceed the maximum pack stock.' using errcode = '22003';
        end if;
        raise exception 'Pack not found while restoring order stock.' using errcode = 'P0002';
      end if;
    end if;
    update public.order_items
       set stock_restored_quantity = stock_restored_quantity + v_restore
     where id = v_item.id;
    v_restored_total := v_restored_total + v_restore;
  end loop;
  return v_restored_total;
end;
$$;
revoke all on function public.restore_simple_order_stock(uuid, uuid) from public, anon, authenticated, service_role;
