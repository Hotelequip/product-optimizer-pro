import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface WooStore {
  id: string;
  user_id: string;
  name: string;
  store_url: string;
  consumer_key: string;
  consumer_secret: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

type WooStoreInsert = Omit<WooStore, "id" | "created_at" | "updated_at">;
type WooStoreUpdate = Partial<Omit<WooStore, "id" | "user_id" | "created_at" | "updated_at">> & { id: string };

export function useWooStores() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["woo_stores", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("woo_stores" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as unknown as WooStore[]) ?? [];
    },
    enabled: !!user,
  });
}

export function useCreateWooStore() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (store: Omit<WooStoreInsert, "user_id">) => {
      const { error } = await supabase
        .from("woo_stores" as any)
        .insert({ ...store, user_id: user!.id } as any);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["woo_stores"] }),
  });
}

export function useUpdateWooStore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: WooStoreUpdate) => {
      const { error } = await supabase
        .from("woo_stores" as any)
        .update(updates as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["woo_stores"] }),
  });
}

export function useDeleteWooStore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("woo_stores" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["woo_stores"] }),
  });
}
