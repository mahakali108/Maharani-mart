/**
 * Complete Supabase database types — Phase 2.
 * Covers all 27 tables defined across:
 *   supabase/migrations/0001_init.sql
 *   supabase/migrations/0002_auth_trigger.sql
 *   supabase/migrations/0003_storage_buckets.sql
 *   supabase/migrations/0004_product_packs.sql
 *
 * Once things stabilize further, this can be replaced with the CLI-generated
 * equivalent:
 *   npx supabase gen types typescript --project-id <ref> > types/database.types.ts
 */

export type UserRoleEnum = 'super_admin' | 'admin' | 'staff' | 'salesman' | 'retailer';
export type RetailerStatusEnum = 'pending_approval' | 'active' | 'suspended';
export type NotificationChannelEnum = 'whatsapp' | 'sms' | 'push' | 'in_app';
export type NotificationStatusEnum = 'queued' | 'sent' | 'delivered' | 'failed';
export type OrderStatusEnum =
  | 'pending' | 'confirmed' | 'processing' | 'packed' | 'dispatched' | 'delivered' | 'cancelled' | 'returned';
export type StockMovementTypeEnum =
  | 'inward' | 'outward' | 'damage' | 'return' | 'transfer' | 'adjustment'
  // Added by 0017_inventory_batches_fefo_grn.sql:
  | 'opening_stock' | 'grn_receipt' | 'sale' | 'sale_reservation' | 'sale_release'
  | 'expiry' | 'stock_adjustment' | 'transfer_out' | 'transfer_in' | 'manual_correction';
export type ReturnStatusEnum = 'requested' | 'approved' | 'rejected' | 'completed';
export type PriceScopeEnum = 'base' | 'area' | 'retailer' | 'scheme' | 'festival';
export type VisitStatusEnum = 'planned' | 'checked_in' | 'checked_out' | 'skipped';
// Added by 0020_super_admin_control_center.sql:
export type AccessStatusEnum = 'active' | 'expiring_soon' | 'expired' | 'suspended' | 'unlimited';
export type FeatureTargetTypeEnum = 'global' | 'role' | 'user';
export type MaintenanceScopeEnum = 'entire_platform' | 'retailer' | 'salesman' | 'admin' | 'staff' | 'warehouse';

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          role: UserRoleEnum;
          full_name: string;
          phone: string;
          avatar_url: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          role?: UserRoleEnum;
          full_name: string;
          phone: string;
          avatar_url?: string | null;
          is_active?: boolean;
        };
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
        Relationships: [];
      };

      areas: {
        Row: {
          id: string;
          name: string;
          district: string;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          district?: string;
          is_active?: boolean;
        };
        Update: Partial<Database['public']['Tables']['areas']['Insert']>;
        Relationships: [];
      };

      warehouses: {
        Row: {
          id: string;
          name: string;
          area_id: string | null;
          address: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          area_id?: string | null;
          address?: string | null;
          is_active?: boolean;
        };
        Update: Partial<Database['public']['Tables']['warehouses']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'warehouses_area_id_fkey';
            columns: ['area_id'];
            isOneToOne: false;
            referencedRelation: 'areas';
            referencedColumns: ['id'];
          }
        ];
      };

      retailers: {
        Row: {
          id: string;
          shop_name: string;
          gstin: string | null;
          area_id: string;
          address: string | null;
          credit_limit: number;
          outstanding_balance: number;
          status: RetailerStatusEnum;
          approved_by: string | null;
          approved_at: string | null;
          assigned_salesman_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          shop_name: string;
          gstin?: string | null;
          area_id: string;
          address?: string | null;
          credit_limit?: number;
          status?: RetailerStatusEnum;
          approved_by?: string | null;
          approved_at?: string | null;
          assigned_salesman_id?: string | null;
        };
        Update: Partial<Database['public']['Tables']['retailers']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'retailers_area_id_fkey';
            columns: ['area_id'];
            isOneToOne: false;
            referencedRelation: 'areas';
            referencedColumns: ['id'];
          }
        ];
      };
      retailer_documents: {
        Row: {
          id: string;
          retailer_id: string;
          doc_type: string;
          file_url: string;
          file_name: string;
          uploaded_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          retailer_id: string;
          doc_type: string;
          file_url: string;
          file_name: string;
          uploaded_by?: string | null;
        };
        Update: Partial<Database['public']['Tables']['retailer_documents']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'retailer_documents_retailer_id_fkey';
            columns: ['retailer_id'];
            isOneToOne: false;
            referencedRelation: 'retailers';
            referencedColumns: ['id'];
          }
        ];
      };

      staff_assignments: {
        Row: {
          id: string;
          staff_id: string;
          area_id: string | null;
          warehouse_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          staff_id: string;
          area_id?: string | null;
          warehouse_id?: string | null;
        };
        Update: Partial<Database['public']['Tables']['staff_assignments']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'staff_assignments_area_id_fkey';
            columns: ['area_id'];
            isOneToOne: false;
            referencedRelation: 'areas';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'staff_assignments_warehouse_id_fkey';
            columns: ['warehouse_id'];
            isOneToOne: false;
            referencedRelation: 'warehouses';
            referencedColumns: ['id'];
          }
        ];
      };

      brands: {
        Row: {
          id: string;
          name: string;
          logo_url: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          logo_url?: string | null;
          is_active?: boolean;
        };
        Update: Partial<Database['public']['Tables']['brands']['Insert']>;
        Relationships: [];
      };

      categories: {
        Row: {
          id: string;
          name: string;
          parent_id: string | null;
          image_url: string | null;
          sort_order: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          parent_id?: string | null;
          image_url?: string | null;
          sort_order?: number;
          is_active?: boolean;
        };
        Update: Partial<Database['public']['Tables']['categories']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'categories_parent_id_fkey';
            columns: ['parent_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          }
        ];
      };

      products: {
        Row: {
          id: string;
          sku_code: string;
          name: string;
          brand_id: string | null;
          category_id: string | null;
          unit: string;
          units_per_case: number;
          base_price: number;
          cost_price: number | null;
          gst_percent: number;
          hsn_code: string | null;
          lead_time_days: number;
          is_new_launch: boolean;
          is_active: boolean;
          barcode: string | null;
          min_stock: number;
          reorder_level: number;
          max_stock: number;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          /**
           * Legacy internal identifier. Removed from the product workflow in
           * migration 0023 — optional on insert, where the database fills in a
           * generated default. Never collected from or shown to a user.
           */
          sku_code?: string;
          name: string;
          brand_id?: string | null;
          category_id?: string | null;
          unit: string;
          units_per_case?: number;
          base_price: number;
          cost_price?: number | null;
          gst_percent?: number;
          hsn_code?: string | null;
          lead_time_days?: number;
          is_new_launch?: boolean;
          is_active?: boolean;
          barcode?: string | null;
          min_stock?: number;
          reorder_level?: number;
          max_stock?: number;
          created_by?: string | null;
        };
        Update: Partial<Database['public']['Tables']['products']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'products_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'products_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          }
        ];
      };

      product_images: {
        Row: {
          id: string;
          product_id: string;
          image_url: string;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          image_url: string;
          sort_order?: number;
        };
        Update: Partial<Database['public']['Tables']['product_images']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'product_images_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          }
        ];
      };

      product_packs: {
        Row: {
          id: string;
          product_id: string;
          pack_name: string;
          pack_sku_code: string;
          units_per_case: number;
          base_price: number;
          cost_price: number | null;
          mrp: number | null;
          ptr: number | null;
          wholesale_price: number | null;
          case_price: number;
          barcode: string | null;
          image_url: string | null;
          moq: number;
          is_active: boolean;
          sort_order: number;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          pack_name: string;
          pack_sku_code: string;
          units_per_case?: number;
          base_price: number;
          cost_price?: number | null;
          mrp?: number | null;
          ptr?: number | null;
          wholesale_price?: number | null;
          case_price: number;
          barcode?: string | null;
          image_url?: string | null;
          moq?: number;
          is_active?: boolean;
          sort_order?: number;
          created_by?: string | null;
        };
        Update: Partial<Database['public']['Tables']['product_packs']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'product_packs_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          }
        ];
      };

      product_pricing_tiers: {
        Row: {
          id: string;
          product_pack_id: string;
          min_quantity: number;
          max_quantity: number | null;
          price_per_piece: number;
          rule_type: 'default' | 'case' | 'bulk';
          label: string | null;
          is_active: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          product_pack_id: string;
          min_quantity: number;
          max_quantity?: number | null;
          price_per_piece: number;
          rule_type?: 'default' | 'case' | 'bulk';
          label?: string | null;
          is_active?: boolean;
          created_by?: string | null;
        };
        Update: Partial<Database['public']['Tables']['product_pricing_tiers']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'product_pricing_tiers_product_pack_id_fkey';
            columns: ['product_pack_id'];
            isOneToOne: false;
            referencedRelation: 'product_packs';
            referencedColumns: ['id'];
          }
        ];
      };

      banners: {
        Row: {
          id: string;
          title: string;
          image_url: string;
          link_url: string | null;
          area_id: string | null;
          sort_order: number;
          is_active: boolean;
          starts_at: string | null;
          ends_at: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          image_url: string;
          link_url?: string | null;
          area_id?: string | null;
          sort_order?: number;
          is_active?: boolean;
          starts_at?: string | null;
          ends_at?: string | null;
          created_by?: string | null;
        };
        Update: Partial<Database['public']['Tables']['banners']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'banners_area_id_fkey';
            columns: ['area_id'];
            isOneToOne: false;
            referencedRelation: 'areas';
            referencedColumns: ['id'];
          }
        ];
      };

      schemes: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          is_festival: boolean;
          starts_at: string;
          ends_at: string;
          is_active: boolean;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          is_festival?: boolean;
          starts_at: string;
          ends_at: string;
          is_active?: boolean;
          created_by?: string | null;
        };
        Update: Partial<Database['public']['Tables']['schemes']['Insert']>;
        Relationships: [];
      };

      price_lists: {
        Row: {
          id: string;
          product_id: string;
          scope: PriceScopeEnum;
          area_id: string | null;
          retailer_id: string | null;
          scheme_id: string | null;
          price: number;
          priority: number;
          valid_from: string;
          valid_to: string | null;
          is_active: boolean;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          scope: PriceScopeEnum;
          area_id?: string | null;
          retailer_id?: string | null;
          scheme_id?: string | null;
          price: number;
          priority?: number;
          valid_from?: string;
          valid_to?: string | null;
          is_active?: boolean;
          created_by?: string | null;
        };
        Update: Partial<Database['public']['Tables']['price_lists']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'price_lists_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'price_lists_area_id_fkey';
            columns: ['area_id'];
            isOneToOne: false;
            referencedRelation: 'areas';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'price_lists_retailer_id_fkey';
            columns: ['retailer_id'];
            isOneToOne: false;
            referencedRelation: 'retailers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'price_lists_scheme_id_fkey';
            columns: ['scheme_id'];
            isOneToOne: false;
            referencedRelation: 'schemes';
            referencedColumns: ['id'];
          }
        ];
      };

      inventory_stock: {
        Row: {
          id: string;
          product_id: string;
          warehouse_id: string;
          quantity: number;
          reserved_quantity: number;
          updated_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          warehouse_id: string;
          quantity?: number;
          reserved_quantity?: number;
        };
        Update: Partial<Database['public']['Tables']['inventory_stock']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'inventory_stock_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'inventory_stock_warehouse_id_fkey';
            columns: ['warehouse_id'];
            isOneToOne: false;
            referencedRelation: 'warehouses';
            referencedColumns: ['id'];
          }
        ];
      };

      stock_movements: {
        Row: {
          id: string;
          product_id: string;
          warehouse_id: string;
          movement_type: StockMovementTypeEnum;
          quantity: number;
          reference_order_id: string | null;
          reason: string | null;
          performed_by: string;
          created_at: string;
          // Added by 0017_inventory_batches_fefo_grn.sql:
          batch_id: string | null;
          reference_type: string | null;
          reference_id: string | null;
          previous_quantity: number | null;
          new_quantity: number | null;
          direction: 'in' | 'out' | null;
          releases_reserved: number;
          seq: number;
        };
        Insert: {
          id?: string;
          product_id: string;
          warehouse_id: string;
          movement_type: StockMovementTypeEnum;
          quantity: number;
          reference_order_id?: string | null;
          reason?: string | null;
          performed_by: string;
          // Added by 0017_inventory_batches_fefo_grn.sql:
          batch_id?: string | null;
          reference_type?: string | null;
          reference_id?: string | null;
          previous_quantity?: number | null;
          new_quantity?: number | null;
          direction?: 'in' | 'out' | null;
          releases_reserved?: number;
          seq?: number;
        };
        Update: Partial<Database['public']['Tables']['stock_movements']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'stock_movements_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stock_movements_warehouse_id_fkey';
            columns: ['warehouse_id'];
            isOneToOne: false;
            referencedRelation: 'warehouses';
            referencedColumns: ['id'];
          }
        ];
      };

      cart_items: {
        Row: {
          id: string;
          retailer_id: string;
          product_id: string;
          pack_id: string;
          quantity: number;
          updated_at: string;
        };
        Insert: {
          id?: string;
          retailer_id: string;
          product_id?: string;
          pack_id: string;
          quantity: number;
        };
        Update: Partial<Database['public']['Tables']['cart_items']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'cart_items_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cart_items_pack_id_fkey';
            columns: ['pack_id'];
            isOneToOne: false;
            referencedRelation: 'product_packs';
            referencedColumns: ['id'];
          }
        ];
      };

      retailer_favorites: {
        Row: {
          id: string;
          retailer_id: string;
          product_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          retailer_id: string;
          product_id: string;
        };
        Update: Partial<Database['public']['Tables']['retailer_favorites']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'retailer_favorites_retailer_id_fkey';
            columns: ['retailer_id'];
            isOneToOne: false;
            referencedRelation: 'retailers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'retailer_favorites_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          }
        ];
      };

      orders: {
        Row: {
          id: string;
          order_number: string;
          retailer_id: string;
          warehouse_id: string | null;
          status: OrderStatusEnum;
          collected_by: string | null;
          subtotal: number;
          discount_total: number;
          gst_total: number;
          grand_total: number;
          notes: string | null;
          cancelled_reason: string | null;
          dispatched_by: string | null;
          dispatched_at: string | null;
          delivered_at: string | null;
          placed_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          order_number?: string;
          retailer_id: string;
          warehouse_id?: string | null;
          status?: OrderStatusEnum;
          collected_by?: string | null;
          subtotal?: number;
          discount_total?: number;
          gst_total?: number;
          grand_total?: number;
          notes?: string | null;
          cancelled_reason?: string | null;
          dispatched_by?: string | null;
          dispatched_at?: string | null;
          delivered_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['orders']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'orders_retailer_id_fkey';
            columns: ['retailer_id'];
            isOneToOne: false;
            referencedRelation: 'retailers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_warehouse_id_fkey';
            columns: ['warehouse_id'];
            isOneToOne: false;
            referencedRelation: 'warehouses';
            referencedColumns: ['id'];
          }
        ];
      };

      order_items: {
        Row: {
          id: string;
          order_id: string;
          product_id: string;
          pack_id: string | null;
          quantity: number;
          unit_price: number;
          gst_percent: number;
          line_total: number;
        };
        Insert: {
          id?: string;
          order_id: string;
          product_id: string;
          pack_id?: string | null;
          quantity: number;
          unit_price: number;
          gst_percent?: number;
          line_total: number;
        };
        Update: Partial<Database['public']['Tables']['order_items']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'order_items_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_items_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_items_pack_id_fkey';
            columns: ['pack_id'];
            isOneToOne: false;
            referencedRelation: 'product_packs';
            referencedColumns: ['id'];
          }
        ];
      };

      order_status_history: {
        Row: {
          id: string;
          order_id: string;
          status: OrderStatusEnum;
          changed_by: string | null;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          status: OrderStatusEnum;
          changed_by?: string | null;
          note?: string | null;
        };
        Update: Partial<Database['public']['Tables']['order_status_history']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'order_status_history_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          }
        ];
      };
      return_requests: {
        Row: {
          id: string;
          order_id: string;
          order_item_id: string | null;
          retailer_id: string;
          reason: string;
          status: ReturnStatusEnum;
          requested_at: string;
          resolved_by: string | null;
          resolved_at: string | null;
          resolution_note: string | null;
        };
        Insert: {
          id?: string;
          order_id: string;
          order_item_id?: string | null;
          retailer_id: string;
          reason: string;
          status?: ReturnStatusEnum;
          resolved_by?: string | null;
          resolved_at?: string | null;
          resolution_note?: string | null;
        };
        Update: Partial<Database['public']['Tables']['return_requests']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'return_requests_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'return_requests_order_item_id_fkey';
            columns: ['order_item_id'];
            isOneToOne: false;
            referencedRelation: 'order_items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'return_requests_retailer_id_fkey';
            columns: ['retailer_id'];
            isOneToOne: false;
            referencedRelation: 'retailers';
            referencedColumns: ['id'];
          }
        ];
      };

      routes: {
        Row: {
          id: string;
          name: string;
          salesman_id: string;
          area_id: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          salesman_id: string;
          area_id?: string | null;
          is_active?: boolean;
        };
        Update: Partial<Database['public']['Tables']['routes']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'routes_area_id_fkey';
            columns: ['area_id'];
            isOneToOne: false;
            referencedRelation: 'areas';
            referencedColumns: ['id'];
          }
        ];
      };

      route_customers: {
        Row: {
          id: string;
          route_id: string;
          retailer_id: string;
          visit_day: number | null;
          sort_order: number;
        };
        Insert: {
          id?: string;
          route_id: string;
          retailer_id: string;
          visit_day?: number | null;
          sort_order?: number;
        };
        Update: Partial<Database['public']['Tables']['route_customers']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'route_customers_route_id_fkey';
            columns: ['route_id'];
            isOneToOne: false;
            referencedRelation: 'routes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'route_customers_retailer_id_fkey';
            columns: ['retailer_id'];
            isOneToOne: false;
            referencedRelation: 'retailers';
            referencedColumns: ['id'];
          }
        ];
      };

      visits: {
        Row: {
          id: string;
          salesman_id: string;
          retailer_id: string;
          status: VisitStatusEnum;
          check_in_at: string | null;
          check_in_lat: number | null;
          check_in_lng: number | null;
          check_out_at: string | null;
          order_id: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          salesman_id: string;
          retailer_id: string;
          status?: VisitStatusEnum;
          check_in_at?: string | null;
          check_in_lat?: number | null;
          check_in_lng?: number | null;
          check_out_at?: string | null;
          order_id?: string | null;
          notes?: string | null;
        };
        Update: Partial<Database['public']['Tables']['visits']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'visits_retailer_id_fkey';
            columns: ['retailer_id'];
            isOneToOne: false;
            referencedRelation: 'retailers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'visits_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          }
        ];
      };

      attendance: {
        Row: {
          id: string;
          user_id: string;
          punch_in_at: string;
          punch_in_lat: number | null;
          punch_in_lng: number | null;
          punch_out_at: string | null;
          punch_out_lat: number | null;
          punch_out_lng: number | null;
          work_date: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          punch_in_at: string;
          punch_in_lat?: number | null;
          punch_in_lng?: number | null;
          punch_out_at?: string | null;
          punch_out_lat?: number | null;
          punch_out_lng?: number | null;
          work_date?: string;
        };
        Update: Partial<Database['public']['Tables']['attendance']['Insert']>;
        Relationships: [];
      };

      notifications: {
        Row: {
          id: string;
          recipient_id: string;
          title: string;
          body: string;
          link_url: string | null;
          is_read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          recipient_id: string;
          title: string;
          body: string;
          link_url?: string | null;
          is_read?: boolean;
        };
        Update: Partial<Database['public']['Tables']['notifications']['Insert']>;
        Relationships: [];
      };

      notification_logs: {
        Row: {
          id: string;
          recipient_id: string | null;
          channel: NotificationChannelEnum;
          status: NotificationStatusEnum;
          provider_message_id: string | null;
          payload: Record<string, unknown> | null;
          error: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          recipient_id?: string | null;
          channel: NotificationChannelEnum;
          status?: NotificationStatusEnum;
          provider_message_id?: string | null;
          payload?: Record<string, unknown> | null;
          error?: string | null;
        };
        Update: Partial<Database['public']['Tables']['notification_logs']['Insert']>;
        Relationships: [];
      };

      ai_predictions: {
        Row: {
          id: string;
          prediction_type: string;
          scope_id: string | null;
          payload: Record<string, unknown>;
          confidence: number | null;
          computed_at: string;
        };
        Insert: {
          id?: string;
          prediction_type: string;
          scope_id?: string | null;
          payload: Record<string, unknown>;
          confidence?: number | null;
        };
        Update: Partial<Database['public']['Tables']['ai_predictions']['Insert']>;
        Relationships: [];
      };

      retailer_insights: {
        Row: {
          retailer_id: string;
          recency_score: number | null;
          frequency_score: number | null;
          monetary_score: number | null;
          last_order_at: string | null;
          avg_order_value: number | null;
          updated_at: string;
        };
        Insert: {
          retailer_id: string;
          recency_score?: number | null;
          frequency_score?: number | null;
          monetary_score?: number | null;
          last_order_at?: string | null;
          avg_order_value?: number | null;
        };
        Update: Partial<Database['public']['Tables']['retailer_insights']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'retailer_insights_retailer_id_fkey';
            columns: ['retailer_id'];
            isOneToOne: true;
            referencedRelation: 'retailers';
            referencedColumns: ['id'];
          }
        ];
      };

      audit_logs: {
        Row: {
          id: string;
          table_name: string;
          record_id: string;
          action: string;
          changed_by: string | null;
          old_data: Record<string, unknown> | null;
          new_data: Record<string, unknown> | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          table_name: string;
          record_id: string;
          action: string;
          changed_by?: string | null;
          old_data?: Record<string, unknown> | null;
          new_data?: Record<string, unknown> | null;
        };
        Update: Partial<Database['public']['Tables']['audit_logs']['Insert']>;
        Relationships: [];
      };
      ai_business_memory: {
        Row: { id: string; user_id: string; memory_key: string; memory_value: string; source: string; created_at: string; updated_at: string };
        Insert: { id?: string; user_id: string; memory_key: string; memory_value: string; source?: string };
        Update: Partial<Database['public']['Tables']['ai_business_memory']['Insert']>;
        Relationships: [];
      };
      ai_audit_logs: {
        Row: { id: number; request_id: string; user_id: string; surface: string; provider: string | null; model: string | null; request_type: string; tool_name: string | null; duration_ms: number; success: boolean; error_code: string | null; input_tokens: number | null; output_tokens: number | null; total_tokens: number | null; created_at: string };
        Insert: { request_id: string; user_id: string; surface: string; provider?: string | null; model?: string | null; request_type: string; tool_name?: string | null; duration_ms?: number; success: boolean; error_code?: string | null; input_tokens?: number | null; output_tokens?: number | null; total_tokens?: number | null };
        Update: never;
        Relationships: [];
      };
      ai_rate_limit_windows: {
        Row: { user_id: string; bucket: string; window_started_at: string; request_count: number };
        Insert: { user_id: string; bucket: string; window_started_at: string; request_count?: number };
        Update: Partial<Database['public']['Tables']['ai_rate_limit_windows']['Insert']>;
        Relationships: [];
      };
      ai_confirmed_actions: {
        Row: { nonce: string; user_id: string; consumed_at: string };
        Insert: { nonce: string; user_id: string };
        Update: never;
        Relationships: [];
      };
      ai_demand_forecasts: {
        Row: {
          id: string;
          product_id: string;
          snapshot_days: number;
          demand_7_day: number | null;
          demand_30_day: number | null;
          direction: 'rising' | 'stable' | 'falling';
          trend_change_percent: number | null;
          confidence: number | null;
          confidence_label: 'High' | 'Medium' | 'Low' | 'Insufficient' | null;
          available_stock: number | null;
          stockout_days: number | null;
          stockout_date: string | null;
          stockout_risk: 'none' | 'low' | 'medium' | 'high' | 'critical' | null;
          reorder_quantity: number | null;
          overstock_warning: boolean;
          dead_stock_warning: boolean;
          data_basis: string | null;
          method: string | null;
          created_by: string | null;
          computed_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          snapshot_days: number;
          demand_7_day?: number | null;
          demand_30_day?: number | null;
          direction: 'rising' | 'stable' | 'falling';
          trend_change_percent?: number | null;
          confidence?: number | null;
          confidence_label?: 'High' | 'Medium' | 'Low' | 'Insufficient' | null;
          available_stock?: number | null;
          stockout_days?: number | null;
          stockout_date?: string | null;
          stockout_risk?: 'none' | 'low' | 'medium' | 'high' | 'critical' | null;
          reorder_quantity?: number | null;
          overstock_warning?: boolean;
          dead_stock_warning?: boolean;
          data_basis?: string | null;
          method?: string | null;
          created_by?: string | null;
          computed_at?: string;
        };
        Update: Partial<Database['public']['Tables']['ai_demand_forecasts']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'ai_demand_forecasts_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          }
        ];
      };

      // Added by 0020_super_admin_control_center.sql
      platform_features: {
        Row: {
          id: string;
          key: string;
          name: string;
          description: string | null;
          icon: string | null;
          route: string | null;
          is_enabled: boolean;
          is_implemented: boolean;
          target_type: FeatureTargetTypeEnum;
          target_roles: string[] | null;
          target_user_id: string | null;
          expires_at: string | null;
          sort_order: number;
          created_by: string | null;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          key: string;
          name: string;
          description?: string | null;
          icon?: string | null;
          route?: string | null;
          is_enabled?: boolean;
          is_implemented?: boolean;
          target_type?: FeatureTargetTypeEnum;
          target_roles?: string[] | null;
          target_user_id?: string | null;
          expires_at?: string | null;
          sort_order?: number;
          created_by?: string | null;
          updated_by?: string | null;
        };
        Update: Partial<Database['public']['Tables']['platform_features']['Insert']>;
        Relationships: [];
      };

      user_feature_overrides: {
        Row: {
          id: string;
          user_id: string;
          feature_key: string;
          is_enabled: boolean;
          expires_at: string | null;
          reason: string | null;
          created_by: string | null;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          feature_key: string;
          is_enabled: boolean;
          expires_at?: string | null;
          reason?: string | null;
          created_by?: string | null;
          updated_by?: string | null;
        };
        Update: Partial<Database['public']['Tables']['user_feature_overrides']['Insert']>;
        Relationships: [];
      };

      user_access_periods: {
        Row: {
          id: string;
          user_id: string;
          role: UserRoleEnum;
          status: AccessStatusEnum;
          started_at: string;
          expires_at: string | null;
          created_by: string | null;
          updated_by: string | null;
          reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          role: UserRoleEnum;
          status?: AccessStatusEnum;
          started_at?: string;
          expires_at?: string | null;
          created_by?: string | null;
          updated_by?: string | null;
          reason?: string | null;
        };
        Update: Partial<Database['public']['Tables']['user_access_periods']['Insert']>;
        Relationships: [];
      };

      platform_settings: {
        Row: {
          id: string;
          key: string;
          value: Record<string, unknown>;
          description: string | null;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          key: string;
          value: Record<string, unknown>;
          description?: string | null;
          updated_by?: string | null;
        };
        Update: Partial<Database['public']['Tables']['platform_settings']['Insert']>;
        Relationships: [];
      };

      super_admin_audit_logs: {
        Row: {
          id: string;
          actor_id: string;
          target_id: string | null;
          action: string;
          before_data: Record<string, unknown> | null;
          after_data: Record<string, unknown> | null;
          reason: string | null;
          ip_address: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_id: string;
          target_id?: string | null;
          action: string;
          before_data?: Record<string, unknown> | null;
          after_data?: Record<string, unknown> | null;
          reason?: string | null;
          ip_address?: string | null;
        };
        Update: Partial<Database['public']['Tables']['super_admin_audit_logs']['Insert']>;
        Relationships: [];
      };
    };

    Views: {
      // Added by 0017_inventory_batches_fefo_grn.sql
      inventory_product_totals: {
        Row: {
          product_id: string;
          product_name: string;
          sku_code: string;
          quantity_on_hand: number;
          reserved_quantity: number;
          available_quantity: number;
          batch_quantity: number;
          estimated_value: number;
          min_stock: number;
          reorder_level: number;
          max_stock: number;
          stock_status: 'healthy' | 'low_stock' | 'out_of_stock';
          warehouse_count: number | null;
        };
        Relationships: [];
      };
      inventory_expiry_report: {
        Row: {
          batch_id: string;
          product_id: string;
          product_name: string;
          sku_code: string;
          warehouse_id: string;
          warehouse_name: string;
          batch_number: string;
          manufacturing_date: string | null;
          expiry_date: string | null;
          current_quantity: number;
          reserved_quantity: number;
          available_quantity: number;
          estimated_value: number;
          days_remaining: number | null;
          expiry_status: 'expired' | 'critical' | 'warning' | 'healthy';
        };
        Relationships: [];
      };
      ai_product_demand_daily: {
        Row: {
          product_id: string;
          demand_date: string;
          quantity: number;
          order_count: number;
          cancelled_units: number;
          return_units: number;
        };
        Relationships: [];
      };
    };
    Functions: {
      consume_ai_rate_limit: {
        Args: { p_bucket: string; p_limit: number; p_window_seconds: number };
        Returns: { allowed: boolean; remaining: number; retry_after_seconds: number };
      };
      consume_ai_confirmation: {
        Args: { p_nonce: string };
        Returns: boolean;
      };
      get_retailer_product_availability: {
        Args: { p_product_ids: string[] };
        Returns: { product_id: string; available_quantity: number; stock_status: string }[];
      };
      get_effective_price: {
        Args: { p_product_id: string; p_retailer_id: string };
        Returns: number;
      };
      is_phone_registered: {
        Args: { p_phone: string };
        Returns: boolean;
      };
      // Inventory RPCs (0017_inventory_batches_fefo_grn.sql) — all jsonb:
      reserve_order_stock: {
        Args: { p_order_id: string };
        Returns: Record<string, unknown>;
      };
      release_order_stock: {
        Args: { p_order_id: string };
        Returns: Record<string, unknown>;
      };
      consume_order_stock: {
        Args: { p_order_id: string };
        Returns: Record<string, unknown>;
      };
      confirm_grn: {
        Args: { p_grn_id: string };
        Returns: Record<string, unknown>;
      };
      cancel_grn: {
        Args: { p_grn_id: string; p_reason?: string | null };
        Returns: Record<string, unknown>;
      };
      execute_stock_transfer: {
        Args: { p_transfer_id: string };
        Returns: Record<string, unknown>;
      };
      cancel_stock_transfer: {
        Args: { p_transfer_id: string; p_reason?: string | null };
        Returns: Record<string, unknown>;
      };
      record_batch_loss: {
        Args: { p_batch_id: string; p_quantity: number; p_loss_type: string; p_reason: string | null };
        Returns: Record<string, unknown>;
      };
      adjust_product_stock: {
        Args: {
          p_product_id: string;
          p_warehouse_id: string;
          p_quantity: number;
          p_reason: string;
          p_batch_id?: string | null;
        };
        Returns: Record<string, unknown>;
      };
      return_order_stock: {
        Args: { p_order_id: string; p_order_item_id?: string | null };
        Returns: Record<string, unknown>;
      };
      // Added by 0020_super_admin_control_center.sql
      is_user_access_valid: {
        Args: { p_user_id: string };
        Returns: boolean;
      };
      get_active_access: {
        Args: { p_user_id: string };
        Returns: { status: string; started_at: string; expires_at: string | null }[];
      };
      is_feature_enabled_for_user: {
        Args: { p_user_id: string; p_feature_key: string };
        Returns: boolean;
      };
    };
    Enums: {
      user_role: UserRoleEnum;
      retailer_status: RetailerStatusEnum;
      notification_channel: NotificationChannelEnum;
      notification_status: NotificationStatusEnum;
      order_status: OrderStatusEnum;
      stock_movement_type: StockMovementTypeEnum;
      price_scope: PriceScopeEnum;
      visit_status: VisitStatusEnum;
      return_status: ReturnStatusEnum;
      // Added by 0020_super_admin_control_center.sql
      access_status: AccessStatusEnum;
      feature_target_type: FeatureTargetTypeEnum;
      maintenance_scope: MaintenanceScopeEnum;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
