import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export interface ImportSession {
  id: string;
  user_id: string;
  mode: string;
  status: string;
  files_used: { name: string; type: string; size: number }[];
  products_processed: number;
  products_created: number;
  products_updated: number;
  errors: { product?: string; message: string; timestamp: string }[];
  log: { action: string; detail: string; timestamp: string }[];
  created_at: string;
  completed_at: string | null;
}

export function useImportSessions() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["import_sessions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("import_sessions" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as unknown as ImportSession[]) ?? [];
    },
    enabled: !!user,
  });
}

export function useCreateImportSession() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (session: { mode: string; files_used?: any[] }) => {
      const { data, error } = await supabase
        .from("import_sessions" as any)
        .insert({ ...session, user_id: user!.id, status: "in_progress" } as any)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as ImportSession;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["import_sessions"] }),
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}

export function useUpdateImportSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ImportSession> & { id: string }) => {
      const { error } = await supabase
        .from("import_sessions" as any)
        .update(updates as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["import_sessions"] }),
  });
}
