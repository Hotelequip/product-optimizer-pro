import { useState } from "react";
import { useCategories, useCreateCategory, useDeleteCategory } from "@/hooks/useCategories";
import { useWooStores } from "@/hooks/useWooStores";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, RefreshCw, Loader2, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export default function Categories() {
  const { data: categories = [], isLoading } = useCategories();
  const { data: wooStores = [] } = useWooStores();
  const createCategory = useCreateCategory();
  const deleteCategory = useDeleteCategory();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ created: number; skipped: number; total_woo: number } | null>(null);

  const activeStores = wooStores.filter(s => s.is_active);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await createCategory.mutateAsync(name.trim());
    setName("");
  };

  const syncFromWoo = async (storeId: string) => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("woo-sync", {
        body: { action: "sync_categories", store_id: storeId },
      });
      if (error) throw error;
      if (data.success) {
        setSyncResult({ created: data.created, skipped: data.skipped, total_woo: data.total_woo });
        queryClient.invalidateQueries({ queryKey: ["categories"] });
        toast({
          title: `Sincronização concluída!`,
          description: `${data.created} novas categorias importadas, ${data.skipped} já existiam. Total WooCommerce: ${data.total_woo}`,
        });
      } else {
        toast({ title: "Erro", description: data.error, variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Erro na sincronização", description: e.message, variant: "destructive" });
    }
    setSyncing(false);
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
            {syncResult && (
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
