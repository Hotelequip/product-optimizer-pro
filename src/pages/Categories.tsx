import { useState, useEffect, useRef, useMemo } from "react";
import { useCategories, useCreateCategory, useDeleteCategory, Category } from "@/hooks/useCategories";
import { useWooStores } from "@/hooks/useWooStores";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Plus, Trash2, RefreshCw, Loader2, CheckCircle2, X, ChevronRight, ChevronDown, Folder, FolderOpen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type SyncPhase = "idle" | "fetching" | "saving" | "done" | "error";

interface TreeNode {
  category: Category;
  children: TreeNode[];
}

function buildTree(categories: Category[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const cat of categories) {
    map.set(cat.id, { category: cat, children: [] });
  }

  for (const cat of categories) {
    const node = map.get(cat.id)!;
    if (cat.parent_id && map.has(cat.parent_id)) {
      map.get(cat.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort children alphabetically
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.category.name.localeCompare(b.category.name));
    for (const n of nodes) sortNodes(n.children);
  };
  sortNodes(roots);

  return roots;
}

function CategoryTreeItem({
  node,
  depth,
  expandedIds,
  toggleExpand,
  onDelete,
}: {
  node: TreeNode;
  depth: number;
  expandedIds: Set<string>;
  toggleExpand: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node.category.id);

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-2 py-2 px-3 hover:bg-muted/50 rounded-md group transition-colors",
          depth > 0 && "border-l border-border"
        )}
        style={{ marginLeft: depth * 24 }}
      >
        {hasChildren ? (
          <button
            onClick={() => toggleExpand(node.category.id)}
            className="p-0.5 rounded hover:bg-accent"
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        ) : (
          <span className="w-5" />
        )}

        {hasChildren && isExpanded ? (
          <FolderOpen className="h-4 w-4 text-primary flex-shrink-0" />
        ) : (
          <Folder className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}

        <span className={cn("text-sm flex-1", hasChildren && "font-medium")}>
          {node.category.name}
        </span>

        {node.category.slug && (
          <span className="text-xs text-muted-foreground font-mono hidden md:inline">
            /{node.category.slug}
          </span>
        )}

        {hasChildren && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {node.children.length}
          </Badge>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => onDelete(node.category.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <CategoryTreeItem
              key={child.category.id}
              node={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              toggleExpand={toggleExpand}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </>
  );
}

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
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const activeStores = wooStores.filter(s => s.is_active);
  const syncing = syncPhase !== "idle" && syncPhase !== "done" && syncPhase !== "error";

  useEffect(() => {
    return () => { if (progressTimer.current) clearInterval(progressTimer.current); };
  }, []);

  const tree = useMemo(() => buildTree(categories), [categories]);

  const filteredTree = useMemo(() => {
    if (!searchTerm.trim()) return tree;
    const term = searchTerm.toLowerCase();
    const matchingIds = new Set<string>();

    // Find all matching categories and their ancestors
    for (const cat of categories) {
      if (cat.name.toLowerCase().includes(term) || (cat.slug && cat.slug.includes(term))) {
        matchingIds.add(cat.id);
        // Add all ancestors
        let parentId = cat.parent_id;
        while (parentId) {
          matchingIds.add(parentId);
          const parent = categories.find(c => c.id === parentId);
          parentId = parent?.parent_id || null;
        }
      }
    }

    const filterNodes = (nodes: TreeNode[]): TreeNode[] =>
      nodes
        .filter(n => matchingIds.has(n.category.id))
        .map(n => ({ ...n, children: filterNodes(n.children) }));

    return filterNodes(tree);
  }, [tree, categories, searchTerm]);

  // Count root vs total
  const rootCount = tree.length;
  const totalCount = categories.length;

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpandedIds(new Set(categories.filter(c => categories.some(ch => ch.parent_id === c.id)).map(c => c.id)));
  const collapseAll = () => setExpandedIds(new Set());

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
            {totalCount} categoria(s) — {rootCount} raíz, {totalCount - rootCount} subcategorias
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
            <div className="space-y-3">
              {/* Controls */}
              <div className="flex items-center gap-3">
                <Input
                  placeholder="Pesquisar categorias..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="max-w-xs h-8 text-sm"
                />
                <Button variant="ghost" size="sm" onClick={expandAll} className="text-xs h-7">
                  Expandir tudo
                </Button>
                <Button variant="ghost" size="sm" onClick={collapseAll} className="text-xs h-7">
                  Colapsar tudo
                </Button>
              </div>

              {/* Tree */}
              <div className="border rounded-lg divide-y-0 py-1">
                {filteredTree.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">Nenhuma categoria encontrada</p>
                ) : (
                  filteredTree.map((node) => (
                    <CategoryTreeItem
                      key={node.category.id}
                      node={node}
                      depth={0}
                      expandedIds={expandedIds}
                      toggleExpand={toggleExpand}
                      onDelete={(id) => deleteCategory.mutate(id)}
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
