import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export interface Catalog {
  id: string;
  user_id: string;
  name: string;
  supplier_url: string | null;
  created_at: string;
}

export function useCatalogs() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["catalogs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalogs")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as Catalog[];
    },
    enabled: !!user,
  });
}

export function useCreateCatalog() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ name, supplier_url }: { name: string; supplier_url?: string }) => {
      const { data, error } = await supabase
        .from("catalogs")
        .insert([{ name, supplier_url: supplier_url || null, user_id: user!.id } as any])
        .select()
        .single();
      if (error) throw error;
      return data as unknown as Catalog;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["catalogs"] });
      toast({ title: "Pasta criada com sucesso!" });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}

export function useUpdateCatalog() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; name?: string; supplier_url?: string | null }) => {
      const { error } = await supabase.from("catalogs").update(updates as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["catalogs"] });
      toast({ title: "Pasta atualizada!" });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}

export function useRenameCatalog() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from("catalogs").update({ name } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["catalogs"] });
      toast({ title: "Pasta renomeada!" });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}

export function useDeleteCatalog() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("catalogs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["catalogs"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      toast({ title: "Pasta removida!" });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}
