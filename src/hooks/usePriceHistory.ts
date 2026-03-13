import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface PriceHistoryEntry {
  id: string;
  product_id: string;
  user_id: string;
  old_price: number;
  new_price: number;
  changed_at: string;
}

export function usePriceHistory(productId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["price_history", productId],
    queryFn: async () => {
      let query = supabase.from("price_history").select("*").order("changed_at", { ascending: false });
      if (productId) query = query.eq("product_id", productId);
      const { data, error } = await query.limit(100);
      if (error) throw error;
      return data as PriceHistoryEntry[];
    },
    enabled: !!user,
  });
}
