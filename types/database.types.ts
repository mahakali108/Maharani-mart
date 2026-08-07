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
export type StockMovementTypeEnum = 'inward' | 'outward' | 'damage' | 'return' | 'transfer' | 'adjustment';
export type ReturnStatusEnum = 'requested' | 'approved' | 'rejected' | 'completed';
export type PriceScopeEnum = 'base' | 'area' | 'retailer' | 'scheme' | 'festival';
export type VisitStatusEnum = 'planned' | 'checked_in' | 'checked_out' | 'skipped';

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
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          sku_code: string;
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
          barcode: string | null;
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
          barcode?: string | null;
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
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      get_effective_price: {
        Args: { p_product_id: string; p_retailer_id: string };
        Returns: number;
      };
      is_phone_registered: {
        Args: { p_phone: string };
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
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
