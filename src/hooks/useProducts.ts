import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export interface Product {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  category_id: string | null;
  cost: number;
  price: number;
  stock: number;
  status: "active" | "inactive" | "draft";
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

export function useProducts() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Product[];
    },
    enabled: !!user,
  });
}

export function useCreateProduct() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (product: Omit<Product, "id" | "user_id" | "created_at" | "updated_at">) => {
      const { data, error } = await supabase.from("products").insert([{ ...product, user_id: user!.id }]).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      toast({ title: "Produto criado com sucesso!" });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Product> & { id: string }) => {
      // Record price change if price changed
      const { data: existing } = await supabase.from("products").select("price").eq("id", id).single();
      if (existing && updates.price !== undefined && existing.price !== updates.price) {
        await supabase.from("price_history").insert([{
          product_id: id,
          user_id: user!.id,
          old_price: existing.price,
          new_price: updates.price,
        }]);
      }
      const { data, error } = await supabase.from("products").update(updates).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["price_history"] });
      toast({ title: "Produto atualizado!" });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      toast({ title: "Produto removido!" });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}
