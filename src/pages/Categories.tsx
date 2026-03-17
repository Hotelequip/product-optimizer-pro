import { useState, useEffect, useRef } from "react";
import { useCategories, useCreateCategory, useDeleteCategory } from "@/hooks/useCategories";
import { useWooStores } from "@/hooks/useWooStores";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Plus, Trash2, RefreshCw, Loader2, CheckCircle2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

type SyncPhase = "idle" | "fetching" | "saving" | "done" | "error";

export default function Categories() {
  const { data: categories = [], isLoading } = useCategories();
  const { data: wooStores = [] } = useWooStores();
  const createCategory = useCreateCategory();
  const deleteCategory = useDeleteCategory();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [syncPhase, setSyncPhase] = useState<SyncPhase>("idle");
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncLabel, setSyncLabel] = useState("");
  const [syncResult, setSyncResult] = useState<{ created: number; skipped: number; total_woo: number } | null>(null);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const activeStores = wooStores.filter(s => s.is_active);
  const syncing = syncPhase !== "idle" && syncPhase !== "done" && syncPhase !== "error";

  // Cleanup timer on unmount
  useEffect(() => {
    return () => { if (progressTimer.current) clearInterval(progressTimer.current); };
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await createCategory.mutateAsync(name.trim());
    setName("");
  };

  const syncFromWoo = async (storeId: string) => {
    setSyncPhase("fetching");
    setSyncProgress(0);
    setSyncResult(null);
    setSyncLabel("A buscar categorias do WooCommerce...");

    // Simulate progress while waiting for the backend
    let fakeProgress = 0;
    if (progressTimer.current) clearInterval(progressTimer.current);
    progressTimer.current = setInterval(() => {
      fakeProgress = Math.min(fakeProgress + Math.random() * 8, 85);
      setSyncProgress(fakeProgress);
    }, 400);

    try {
      const { data, error } = await supabase.functions.invoke("woo-sync", {
        body: { action: "sync_categories", store_id: storeId },
      });

      if (progressTimer.current) clearInterval(progressTimer.current);

      if (error) throw error;

      if (data.success) {
        setSyncPhase("saving");
        setSyncProgress(90);
        setSyncLabel(`A guardar ${data.created} novas categorias...`);

        // Small delay to show saving phase
        await new Promise(r => setTimeout(r, 500));

        setSyncProgress(100);
        setSyncLabel(`Concluído! ${data.created} novas, ${data.skipped} existentes`);
        setSyncResult({ created: data.created, skipped: data.skipped, total_woo: data.total_woo });
        setSyncPhase("done");
        queryClient.invalidateQueries({ queryKey: ["categories"] });

        toast({
          title: `Sincronização concluída!`,
          description: `${data.created} novas categorias importadas de ${data.total_woo} no WooCommerce.`,
        });
      } else {
        setSyncPhase("error");
        setSyncLabel(data.error || "Erro desconhecido");
        toast({ title: "Erro", description: data.error, variant: "destructive" });
      }
    } catch (e: any) {
      if (progressTimer.current) clearInterval(progressTimer.current);
      setSyncPhase("error");
      setSyncLabel(e.message);
      toast({ title: "Erro na sincronização", description: e.message, variant: "destructive" });
    }
  };

  const dismissSync = () => {
    setSyncPhase("idle");
    setSyncProgress(0);
    setSyncLabel("");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Categorias</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {categories.length} categoria(s) registadas
          </p>
        </div>

        {activeStores.length > 0 && (
          <div className="flex items-center gap-2">
            {syncResult && syncPhase === "done" && (
              <Badge variant="outline" className="gap-1 text-xs">
                <CheckCircle2 className="h-3 w-3" />
                +{syncResult.created} novas
              </Badge>
            )}
            <Select onValueChange={syncFromWoo} disabled={syncing}>
              <SelectTrigger className="w-[220px]">
                <div className="flex items-center gap-2">
                  {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  <span>{syncing ? "Sincronizando..." : "Sincronizar WooCommerce"}</span>
                </div>
              </SelectTrigger>
              <SelectContent>
                {activeStores.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Sync progress bar */}
      {syncPhase !== "idle" && (
        <Card className="border-primary/20">
          <CardContent className="py-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                {syncing && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                {syncPhase === "done" && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                {syncPhase === "error" && <X className="h-4 w-4 text-destructive" />}
                <span className="font-medium">{syncLabel}</span>
              </div>
              {(syncPhase === "done" || syncPhase === "error") && (
                <Button variant="ghost" size="sm" onClick={dismissSync} className="h-6 px-2 text-xs">
                  Fechar
                </Button>
              )}
            </div>
            <Progress value={syncProgress} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {syncPhase === "fetching" && "A comunicar com o WooCommerce..."}
                {syncPhase === "saving" && "A guardar no sistema..."}
                {syncPhase === "done" && syncResult && `${syncResult.total_woo} categorias no WooCommerce · ${syncResult.created} novas · ${syncResult.skipped} existentes`}
                {syncPhase === "error" && "A sincronização falhou"}
              </span>
              <span>{Math.round(syncProgress)}%</span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Nova Categoria</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="flex gap-3">
            <Input placeholder="Nome da categoria" value={name} onChange={(e) => setName(e.target.value)} className="max-w-sm" />
            <Button type="submit" disabled={createCategory.isPending}>
              <Plus className="mr-2 h-4 w-4" />Criar
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Carregando...</p>
          ) : categories.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">
              Nenhuma categoria criada.
              {activeStores.length > 0 && " Use o botão 'Sincronizar WooCommerce' para importar categorias da sua loja."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => deleteCategory.mutate(c.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
