import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface CatalogFile {
  id: string;
  catalog_id: string | null;
  user_id: string;
  file_name: string;
  file_url: string;
  file_type: string;
  file_size: number;
  created_at: string;
}

export function useCatalogFiles(catalogId?: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["catalog_files", catalogId],
    queryFn: async () => {
      let query = supabase
        .from("catalog_files" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (catalogId && catalogId !== "all" && catalogId !== "uncategorized") {
        query = query.eq("catalog_id", catalogId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data as unknown as CatalogFile[]) ?? [];
    },
    enabled: !!user,
  });
}

export function useAddCatalogFile() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (file: { catalog_id: string | null; file_name: string; file_url: string; file_type: string; file_size: number }) => {
      const { data, error } = await supabase
        .from("catalog_files" as any)
        .insert({ ...file, user_id: user!.id } as any)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as CatalogFile;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["catalog_files"] });
    },
  });
}

export function useDeleteCatalogFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("catalog_files" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["catalog_files"] });
    },
  });
}
