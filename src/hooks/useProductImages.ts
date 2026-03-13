import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface ProductImage {
  id: string;
  product_id: string;
  user_id: string;
  url: string;
  type: "original" | "optimized" | "ai_generated";
  is_primary: boolean;
  created_at: string;
}

export function useProductImages(productId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["product_images", productId],
    queryFn: async () => {
      let query = supabase
        .from("product_images" as any)
        .select("*")
        .order("created_at", { ascending: true });
      if (productId) query = query.eq("product_id", productId);
      const { data, error } = await query;
      if (error) throw error;
      return (data as unknown as ProductImage[]) ?? [];
    },
    enabled: !!user,
  });
}

export function useAllProductImages() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["product_images", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_images" as any)
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as unknown as ProductImage[]) ?? [];
    },
    enabled: !!user,
  });
}

export function useAddProductImage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (image: { product_id: string; url: string; type: string; is_primary?: boolean }) => {
      const { data, error } = await supabase
        .from("product_images" as any)
        .insert({ ...image, user_id: user!.id } as any)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as ProductImage;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product_images"] });
    },
  });
}

export function useDeleteProductImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("product_images" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product_images"] });
    },
  });
}
