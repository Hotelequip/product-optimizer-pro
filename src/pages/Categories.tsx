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
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, RefreshCw, Loader2, CheckCircle2, X, ChevronRight, ChevronDown, Folder, FolderOpen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type SyncPhase = "idle" | "fetching" | "saving" | "done" | "error";

/** Decode HTML entities for display (handles data already stored with encoding) */
function decodeHtmlEntities(text: string): string {
  const doc = new DOMParser().parseFromString(text, "text/html");
  return doc.documentElement.textContent || text;
}

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
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.category.name.localeCompare(b.category.name));
    for (const n of nodes) sortNodes(n.children);
  };
  sortNodes(roots);
  return roots;
}

function collectAllIds(node: TreeNode): string[] {
  return [node.category.id, ...node.children.flatMap(collectAllIds)];
}

function CategoryTreeItem({
  node, depth, expandedIds, toggleExpand, selectedIds, toggleSelect,
  onDelete,
}: {
  node: TreeNode;
  depth: number;
  expandedIds: Set<string>;
  toggleExpand: (id: string) => void;
  selectedIds: Set<string>;
  toggleSelect: (id: string, withChildren: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node.category.id);
  const isSelected = selectedIds.has(node.category.id);

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-2 py-1.5 px-3 hover:bg-muted/50 rounded-md group transition-colors",
          depth > 0 && "border-l border-border",
          isSelected && "bg-primary/5"
        )}
        style={{ marginLeft: depth * 24 }}
      >
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => toggleSelect(node.category.id, false)}
          className="h-3.5 w-3.5"
        />

        {hasChildren ? (
          <button onClick={() => toggleExpand(node.category.id)} className="p-0.5 rounded hover:bg-accent">
            {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </button>
        ) : (
          <span className="w-5" />
        )}

        {hasChildren && isExpanded ? (
          <FolderOpen className="h-4 w-4 text-primary flex-shrink-0" />
        ) : (
          <Folder className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}

        <span className={cn("text-sm flex-1 cursor-pointer", hasChildren && "font-medium")}
          onClick={() => hasChildren && toggleExpand(node.category.id)}>
          {decodeHtmlEntities(node.category.name)}
        </span>

        {node.category.slug && (
          <span className="text-xs text-muted-foreground font-mono hidden md:inline">/{node.category.slug}</span>
        )}

        {hasChildren && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{node.children.length}</Badge>
        )}

        <Button variant="ghost" size="icon"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => onDelete(node.category.id)}>
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
              selectedIds={selectedIds}
              toggleSelect={toggleSelect}
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [bulkDeleting, setBulkDeleting] = useState(false);
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
    for (const cat of categories) {
      if (cat.name.toLowerCase().includes(term) || (cat.slug && cat.slug.includes(term))) {
        matchingIds.add(cat.id);
        let parentId = cat.parent_id;
        while (parentId) {
          matchingIds.add(parentId);
          const parent = categories.find(c => c.id === parentId);
          parentId = parent?.parent_id || null;
        }
      }
    }
    const filterNodes = (nodes: TreeNode[]): TreeNode[] =>
      nodes.filter(n => matchingIds.has(n.category.id)).map(n => ({ ...n, children: filterNodes(n.children) }));
    return filterNodes(tree);
  }, [tree, categories, searchTerm]);

  const rootCount = tree.length;
  const totalCount = categories.length;

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  const toggleSelect = (id: string, _withChildren: boolean) => {
    setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  const selectAll = () => setSelectedIds(new Set(categories.map(c => c.id)));
  const deselectAll = () => setSelectedIds(new Set());
  const expandAll = () => setExpandedIds(new Set(categories.filter(c => categories.some(ch => ch.parent_id === c.id)).map(c => c.id)));
  const collapseAll = () => setExpandedIds(new Set());

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!confirm(`Tem a certeza que quer eliminar ${count} categoria(s)?`)) return;
    setBulkDeleting(true);
    try {
      // Delete in batches to avoid issues with children references
      const ids = Array.from(selectedIds);
      // Delete children first (those whose parent_id is also being deleted)
      const childrenFirst = ids.sort((a, b) => {
        const aIsChild = categories.find(c => c.id === a)?.parent_id ? 1 : 0;
        const bIsChild = categories.find(c => c.id === b)?.parent_id ? 1 : 0;
        return bIsChild - aIsChild; // children first
      });

      const BATCH = 50;
      for (let i = 0; i < childrenFirst.length; i += BATCH) {
        const batch = childrenFirst.slice(i, i + BATCH);
        const { error } = await supabase.from("categories").delete().in("id", batch);
        if (error) throw error;
      }

      queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast({ title: `${count} categorias eliminadas!` });
      setSelectedIds(new Set());
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
    setBulkDeleting(false);
  };

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
        setSyncLabel(`Concluído! ${data.created} novas, ${data.skipped} atualizadas/existentes`);
        setSyncResult({ created: data.created, skipped: data.skipped, total_woo: data.total_woo });
        setSyncPhase("done");
        queryClient.invalidateQueries({ queryKey: ["categories"] });
        toast({ title: `Sincronização concluída!`, description: `${data.created} novas, ${data.skipped} atualizadas. Total WooCommerce: ${data.total_woo}` });
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

  const dismissSync = () => { setSyncPhase("idle"); setSyncProgress(0); setSyncLabel(""); };

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
                <CheckCircle2 className="h-3 w-3" />+{syncResult.created} novas
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
                {activeStores.map(s => (<SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

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
                <Button variant="ghost" size="sm" onClick={dismissSync} className="h-6 px-2 text-xs">Fechar</Button>
              )}
            </div>
            <Progress value={syncProgress} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {syncPhase === "fetching" && "A comunicar com o WooCommerce..."}
                {syncPhase === "saving" && "A guardar no sistema..."}
                {syncPhase === "done" && syncResult && `${syncResult.total_woo} no WooCommerce · ${syncResult.created} novas · ${syncResult.skipped} atualizadas`}
                {syncPhase === "error" && "A sincronização falhou"}
              </span>
              <span>{Math.round(syncProgress)}%</span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-lg">Nova Categoria</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="flex gap-3">
            <Input placeholder="Nome da categoria" value={name} onChange={(e) => setName(e.target.value)} className="max-w-sm" />
            <Button type="submit" disabled={createCategory.isPending}><Plus className="mr-2 h-4 w-4" />Criar</Button>
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
              <div className="flex items-center gap-3 flex-wrap">
                <Input placeholder="Pesquisar categorias..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="max-w-xs h-8 text-sm" />
                <Button variant="ghost" size="sm" onClick={expandAll} className="text-xs h-7">Expandir tudo</Button>
                <Button variant="ghost" size="sm" onClick={collapseAll} className="text-xs h-7">Colapsar tudo</Button>
                <div className="ml-auto flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={selectedIds.size === categories.length ? deselectAll : selectAll} className="text-xs h-7">
                    {selectedIds.size === categories.length ? "Desselecionar tudo" : "Selecionar tudo"}
                  </Button>
                  {selectedIds.size > 0 && (
                    <Button variant="destructive" size="sm" onClick={bulkDelete} disabled={bulkDeleting} className="text-xs h-7 gap-1">
                      {bulkDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                      Eliminar {selectedIds.size} selecionada(s)
                    </Button>
                  )}
                </div>
              </div>

              <div className="border rounded-lg py-1">
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
                      selectedIds={selectedIds}
                      toggleSelect={toggleSelect}
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
