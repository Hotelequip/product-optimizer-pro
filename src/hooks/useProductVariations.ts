import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export interface ProductVariation {
  id: string;
  user_id: string;
  parent_product_id: string;
  sku: string | null;
  ean: string | null;
  name: string | null;
  price: number;
  regular_price: number;
  sale_price: number | null;
  stock: number;
  image_url: string | null;
  attributes: { name: string; value: string }[];
  status: string;
  created_at: string;
  updated_at: string;
}

export function useProductVariations(parentProductId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["product_variations", parentProductId],
    queryFn: async () => {
      let query = supabase
        .from("product_variations" as any)
        .select("*")
        .order("created_at", { ascending: true });
      if (parentProductId) {
        query = query.eq("parent_product_id", parentProductId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data as unknown as ProductVariation[]) ?? [];
    },
    enabled: !!user && !!parentProductId,
  });
}

export function useAllVariations() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["product_variations", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_variations" as any)
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as unknown as ProductVariation[]) ?? [];
    },
    enabled: !!user,
  });
}

export function useCreateVariation() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (variation: Omit<ProductVariation, "id" | "user_id" | "created_at" | "updated_at">) => {
      const { data, error } = await supabase
        .from("product_variations" as any)
        .insert({ ...variation, user_id: user!.id } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product_variations"] });
      toast({ title: "Variação criada!" });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}

export function useUpdateVariation() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ProductVariation> & { id: string }) => {
      const { data, error } = await supabase
        .from("product_variations" as any)
        .update(updates as any)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["product_variations"] }),
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}

export function useDeleteVariation() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("product_variations" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product_variations"] });
      toast({ title: "Variação removida!" });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}
