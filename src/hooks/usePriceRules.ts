import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export interface PriceRule {
  id: string;
  user_id: string;
  name: string;
  category_id: string | null;
  markup_percent: number | null;
  min_margin_percent: number | null;
  rounding: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function usePriceRules() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["price_rules"],
    queryFn: async () => {
      const { data, error } = await supabase.from("price_rules").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as PriceRule[];
    },
    enabled: !!user,
  });
}

export function useCreatePriceRule() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (rule: Omit<PriceRule, "id" | "user_id" | "created_at" | "updated_at">) => {
      const { data, error } = await supabase.from("price_rules").insert(rule).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["price_rules"] });
      toast({ title: "Regra de preço criada!" });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}

export function useDeletePriceRule() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("price_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["price_rules"] });
      toast({ title: "Regra removida!" });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}
